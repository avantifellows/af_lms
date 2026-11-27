import { query } from "@/lib/db";
import type { UserPermission } from "@/lib/permissions";
import { ALUMNI_PROGRAM_ORDER } from "./config";
import { alumniValues } from "./entry";
import { schoolScopeSql, type ScopeSql } from "./scope";
import { cohortCte, cohortParams } from "./students";
import { visibleValues } from "./validation";

// The alumni team's "missing data" table: everyone who has passed out from the
// schools in view — pass-outs not added yet and existing alumni — with the key
// answers, how much of their record is filled, and filters for what's missing.
// Read-only (Postgres). Filters run here, on the server, so the counts and the
// download always match what the table shows.

export { TABLE_FIELDS } from "./table-fields";
export type { AlumniTableRow, TableFilters, TableSummary } from "./table-fields";
import { TABLE_FIELDS, type AlumniTableRow, type TableField, type TableFilters, type TableSummary } from "./table-fields";

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const fullName = (first: unknown, last: unknown) => clean(`${clean(first)} ${clean(last)}`) || "(no name)";

/**
 * How complete a record is, by the form's rule for which fields apply (shown
 * and not stale): the share of applying fields that are filled, and the table
 * fields that apply but are blank.
 */
export function completeness(values: Record<string, string>): { filledPct: number; missing: TableField[] } {
  const applying = visibleValues(values);
  const all = Object.values(applying);
  const filledPct = all.length ? Math.round((all.filter(Boolean).length / all.length) * 100) : 0;
  const missing = TABLE_FIELDS.map((f) => f.key).filter((key) => key in applying && !applying[key]);
  return { filledPct, missing };
}

/** Members of the schools in view, and the matching filter on a school alias. */
function viewScope(permission: UserPermission, schoolCode: string | undefined, first: number) {
  const scope: ScopeSql = schoolCode
    ? { sql: "sc.code = $" + first, params: [schoolCode] }
    : schoolScopeSql(permission, "sc.code", "sc.region", first);
  const scoped = scope.sql !== "TRUE";
  return {
    params: scope.params,
    on: (alias: string) => scope.sql.replace(/\bsc\./g, `${alias}.`),
    members: scoped
      ? `members AS MATERIALIZED (
           SELECT er.user_id FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
           WHERE er.group_type = 'school' AND ${scope.sql}
         )`
      : "",
    inMembers: (column: string) => (scoped ? `AND ${column} IN (SELECT user_id FROM members)` : ""),
  };
}

const EMPTY_VALUES = Object.fromEntries(TABLE_FIELDS.map((f) => [f.key, ""])) as Record<TableField, string>;

async function passOutRows(permission: UserPermission, schoolCode?: string): Promise<AlumniTableRow[]> {
  const params = cohortParams();
  const view = viewScope(permission, schoolCode, params.length + 1);
  const rows = await query<Record<string, string | null>>(
    `WITH ${view.members ? `${view.members},` : ""} ${cohortCte(view.inMembers("er.user_id"))}
     SELECT f.user_id, f.afid, f.first_name, f.last_name, f.passout_year, f.program,
       f.school_code, f.school_name, u.phone, u.whatsapp_phone
     FROM cohort_flagged f
     JOIN "user" u ON u.id = f.user_id
     JOIN school sc ON sc.code = f.school_code
     WHERE NOT f.is_alumni AND COALESCE(f.status, '') <> 'dropout' AND ${view.on("sc")}`,
    [...params, ...view.params],
  );
  return rows.map((r) => ({
    kind: "pass-out",
    id: clean(r.user_id),
    name: fullName(r.first_name, r.last_name),
    afid: clean(r.afid),
    phone: clean(r.phone),
    whatsapp: clean(r.whatsapp_phone),
    cohortYear: clean(r.passout_year),
    program: clean(r.program),
    schoolCode: clean(r.school_code),
    schoolName: clean(r.school_name),
    values: { ...EMPTY_VALUES },
    ...completeness({}),
    updatedAt: "",
  }));
}

async function alumnusRows(permission: UserPermission, schoolCode?: string): Promise<AlumniTableRow[]> {
  const view = viewScope(permission, schoolCode, 2);
  const rows = await query<Record<string, unknown>>(
    `${view.members ? `WITH ${view.members}` : ""}
     SELECT a.*, a.updated_at::text AS updated,
       cu.college_id AS college_code_ug, cu.name AS college_name_ug,
       cp.college_id AS college_code_pg,
       bu.branch_id AS branch_code_ug, bu.name AS branch_name_ug,
       bp.branch_id AS branch_code_pg,
       s.user_id, s.student_id AS afid, u.first_name, u.last_name, u.phone, u.whatsapp_phone,
       sch.code AS school_code, sch.name AS school_name, coh.academic_year AS cohort_year, prog.name AS program
     FROM alumni a
     JOIN student s ON s.id = a.student_id
     JOIN "user" u ON u.id = s.user_id
     LEFT JOIN college cu ON cu.id = a.college_id_ug
     LEFT JOIN college cp ON cp.id = a.college_id_pg
     LEFT JOIN branch bu ON bu.id = a.branch_id_ug
     LEFT JOIN branch bp ON bp.id = a.branch_id_pg
     LEFT JOIN LATERAL (
       SELECT sc.code, sc.name, sc.region
       FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
       WHERE er.user_id = s.user_id AND er.group_type = 'school'
       ORDER BY er.academic_year DESC NULLS LAST, er.is_current DESC, er.id DESC
       LIMIT 1
     ) sch ON true
     LEFT JOIN LATERAL (
       SELECT er.academic_year
       FROM enrollment_record er JOIN grade gr ON gr.id = er.group_id
       WHERE er.user_id = s.user_id AND er.group_type = 'grade' AND gr.number = 12
       ORDER BY er.academic_year DESC NULLS LAST
       LIMIT 1
     ) coh ON true
     LEFT JOIN LATERAL (
       SELECT p.name
       FROM enrollment_record er JOIN batch b ON b.id = er.group_id JOIN program p ON p.id = b.program_id
       WHERE er.user_id = s.user_id AND er.group_type = 'batch'
       ORDER BY array_position($1::int[], b.program_id::int) NULLS LAST,
         (er.academic_year = coh.academic_year) DESC NULLS LAST, er.academic_year DESC NULLS LAST
       LIMIT 1
     ) prog ON true
     WHERE TRUE ${view.inMembers("s.user_id")} AND ${view.on("sch")}`,
    [ALUMNI_PROGRAM_ORDER, ...view.params],
  );
  return rows.map((r) => {
    const values = alumniValues(r);
    const shown = Object.fromEntries(TABLE_FIELDS.map((f) => [f.key, values[f.key] ?? ""])) as Record<TableField, string>;
    shown.college_id_ug = values.college_id_ug ? clean(r.college_name_ug) || values.college_id_ug : "";
    shown.branch_id_ug = values.branch_id_ug ? clean(r.branch_name_ug) || values.branch_id_ug : "";
    return {
      kind: "alumnus" as const,
      id: clean(r.id),
      name: fullName(r.first_name, r.last_name),
      afid: clean(r.afid),
      phone: clean(r.phone),
      whatsapp: clean(r.whatsapp_phone),
      cohortYear: clean(r.cohort_year),
      program: clean(r.program),
      schoolCode: clean(r.school_code),
      schoolName: clean(r.school_name),
      values: shown,
      ...completeness(values),
      updatedAt: clean(r.updated).slice(0, 10),
    };
  });
}

/**
 * Every row in view: one school (`schoolCode`, whose access the caller has
 * checked) or all the person's schools. Pass-outs not added come first in
 * each year, then alumni; newest pass-out year first, then by name.
 */
export async function loadAlumniTable(permission: UserPermission, schoolCode?: string): Promise<AlumniTableRow[]> {
  const [passOuts, alumni] = await Promise.all([passOutRows(permission, schoolCode), alumnusRows(permission, schoolCode)]);
  return [...passOuts, ...alumni].sort(
    (a, b) => b.cohortYear.localeCompare(a.cohortYear) || a.kind.localeCompare(b.kind) * -1 || a.name.localeCompare(b.name),
  );
}

/** Rows matching everything but the field filters (the base the summary counts). */
function matchesBase(row: AlumniTableRow, f: TableFilters): boolean {
  const q = (f.q ?? "").trim().toLowerCase();
  return (
    (!f.years?.length || f.years.includes(row.cohortYear)) &&
    (!f.record || (f.record === "added") === (row.kind === "alumnus")) &&
    (!f.school || row.schoolCode === f.school) &&
    (!q || row.name.toLowerCase().includes(q) || row.afid.includes(q))
  );
}

function matchesFields(row: AlumniTableRow, fields: TableFilters["fields"] = {}): boolean {
  return Object.entries(fields).every(([key, want]) => {
    const field = key as TableField;
    return want === "filled" ? Boolean(row.values[field]) : row.missing.includes(field);
  });
}

export function filterTable(rows: AlumniTableRow[], filters: TableFilters): AlumniTableRow[] {
  return rows.filter((r) => matchesBase(r, filters) && matchesFields(r, filters.fields));
}

/** Counts for the summary: over the year / record / school / search filters, before the field filters. */
export function summarizeTable(rows: AlumniTableRow[], filters: TableFilters): TableSummary {
  const base = rows.filter((r) => matchesBase(r, filters));
  const missing = Object.fromEntries(
    TABLE_FIELDS.map((f) => [f.key, base.filter((r) => r.missing.includes(f.key)).length]),
  ) as Record<TableField, number>;
  return { total: base.length, notAdded: base.filter((r) => r.kind === "pass-out").length, missing };
}

/** Pass-out years present, newest first. */
export const tableYears = (rows: AlumniTableRow[]) =>
  [...new Set(rows.map((r) => r.cohortYear).filter(Boolean))].sort().reverse();
