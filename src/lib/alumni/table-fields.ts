// The "missing data" table's fields and types. No server imports: the
// browser table (AlumniDataTable) uses these too.

/** The answers the table shows and filters on (form columns). */
export const TABLE_FIELDS = [
  { key: "contact_status", label: "Contact status" },
  { key: "current_status", label: "Current status" },
  { key: "ug_status", label: "UG status" },
  { key: "college_id_ug", label: "College" },
  { key: "branch_id_ug", label: "Branch" },
  { key: "degree_ug", label: "Degree" },
  { key: "employment_status", label: "Employment" },
] as const;

export type TableField = (typeof TABLE_FIELDS)[number]["key"];
const FIELD_KEYS = new Set<string>(TABLE_FIELDS.map((f) => f.key));
export const isTableField = (key: string): key is TableField => FIELD_KEYS.has(key);

export interface AlumniTableRow {
  /** "alumnus" (has an alumni row, addressed by alumni.id) or "pass-out" (not added yet, by user id). */
  kind: "alumnus" | "pass-out";
  /** alumni.id for an alumnus, user.id for a pass-out — what the form is opened with. */
  id: string;
  name: string;
  afid: string;
  phone: string;
  whatsapp: string;
  /** Pass-out (cohort) year, e.g. "2024-2025"; "" when unknown. */
  cohortYear: string;
  program: string;
  schoolCode: string;
  schoolName: string;
  /** TABLE_FIELDS answers for display (college / branch by name); "" when blank. */
  values: Record<TableField, string>;
  /**
   * TABLE_FIELDS that are blank but apply to this person (the form's rule):
   * "Missing" means these. A blank field that doesn't apply — College during
   * a gap year — isn't missing; it's shown as n/a.
   */
  missing: TableField[];
  /** Share of the fields that apply to this person that are filled in (0–100). */
  filledPct: number;
  /** When the alumni record was last saved (alumni only). */
  updatedAt: string;
}

export type FieldFilter = "filled" | "missing";

export interface TableFilters {
  years?: string[];
  record?: "added" | "not-added";
  fields?: Partial<Record<TableField, FieldFilter>>;
  /** Name or AFID, any part. */
  q?: string;
  /** One school within the rows (the all-schools table). */
  school?: string;
}

export interface TableSummary {
  total: number;
  notAdded: number;
  missing: Record<TableField, number>;
}
