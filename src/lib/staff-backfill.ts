/**
 * Teacher/PM backfill: turns `user_permission` rows (the freshest assignment
 * source) into real `user` + `teacher` / `staff` rows and filled
 * `centre_positions` seats.
 *
 * Inputs:
 * - user_permission (role = teacher | program_manager, not revoked)
 * - the AF-ID review sheet (TSV export) for employee codes
 * - an HR employees dump (JSON) for subjects/designations
 *
 * Rules (agreed 2026-06-12):
 * - Every teacher is backfilled; AF code where known, NULL otherwise
 *   (admins fill missing codes in the Staff Management UI).
 * - Dedupe against existing teacher rows by AF code first, exact
 *   normalized name second (most existing AF-teacher user rows have no
 *   email, so an email join cannot prove absence). On collision LINK the
 *   existing row instead of creating a second identity for the same code.
 * - `staff` (non-teaching) requires employee_code at the DB level, so PMs
 *   without a confirmed code get a user row + user_permission link only,
 *   and are reported as pending.
 * - Sheet TEST_ACCOUNT rows are skipped unless the team overrides via
 *   team_decision; they are listed in the report.
 *
 * Writes are direct SQL (not the db-service REST API): this is a one-time,
 * idempotent migration script run with --apply after a reviewed dry-run.
 * Interactive teacher creation in the UI should still go through db-service.
 */

import * as fs from "fs";
import type { PoolClient } from "pg";
import { query, withTransaction } from "./db";
import { normalizeEmployeeCode, type SeatRole } from "./staff-shared";

export type BackfillMode = "dry-run" | "apply";

export interface SheetRow {
  status: string;
  email: string;
  role: string;
  lmsName: string;
  proposedAfId: string;
  teamDecision: string;
  correctAfId: string;
}

export interface HrEmployee {
  employee_code: string;
  name: string;
  subject: string | null;
  staff_type: string | null;
  designation: string | null;
  centre: string | null;
  is_vacant: number | boolean;
}

export interface CodeResolution {
  include: boolean;
  code: string | null;
  source:
    | "team_correct_af_id"
    | "team_ok_proposed"
    | "auto_matched"
    | "unconfirmed"
    | "not_in_sheet"
    | "excluded_by_team"
    | "test_account";
  warning?: string;
}

export interface CentreRef {
  id: number;
  name: string;
  typeCode: string | null;
  schoolCode: string;
}

export type { SeatRole };

export interface PlannedSeat {
  centreId: number;
  centreName: string;
  role: SeatRole;
}

export interface PersonPlan {
  email: string;
  role: "teacher" | "program_manager";
  fullName: string;
  code: string | null;
  codeSource: CodeResolution["source"];
  skipped: boolean;
  skipReason?:
    | "excluded_by_team"
    | "test_account"
    | "needs_review_duplicate_code"
    | "needs_review_name_collision";
  userAction:
    | "already_linked"
    | "link_by_af_code"
    | "link_by_email"
    | "link_by_name"
    | "create";
  existingUserId: number | null;
  setEmailOnUser: boolean;
  teacherAction: "create" | "update_existing" | "none";
  existingTeacherId: number | null;
  subjectId: number | null;
  designation: string | null;
  staffAction: "create" | "exists" | "pending_no_code" | "none";
  seats: PlannedSeat[];
  seatGaps: string[];
  warnings: string[];
}

export interface BackfillReport {
  mode: BackfillMode;
  ok: boolean;
  error?: string;
  counts: {
    sourceTeachers: number;
    sourcePms: number;
    skipped: number;
    usersToCreate: number;
    usersLinked: number;
    teachersToCreate: number;
    teachersLinkedExisting: number;
    teachersWithCode: number;
    teachersWithoutCode: number;
    staffToCreate: number;
    staffPendingNoCode: number;
    seatsToCreate: number;
    seatsExisting: number;
  };
  plans: PersonPlan[];
  warnings: string[];
}

// --- Pure helpers (exported for tests) ---

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitFullName(fullName: string): {
  firstName: string;
  lastName: string | null;
} {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: "", lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens[0], lastName: tokens.slice(1).join(" ") };
}

// Canonical AF-code normalization lives in staff-shared (used by the live admin
// surface too); keep this name as the backfill's entry point so they can't drift.
export const normalizeAfCode = normalizeEmployeeCode;

export function resolveAfCode(row: SheetRow | undefined): CodeResolution {
  if (!row) {
    return { include: true, code: null, source: "not_in_sheet" };
  }

  const decision = row.teamDecision.trim().toLowerCase();
  const correct = row.correctAfId.trim();
  const proposed = row.proposedAfId.trim();

  if (decision.includes("exclude")) {
    return { include: false, code: null, source: "excluded_by_team" };
  }

  if (correct) {
    const code = normalizeAfCode(correct);
    return {
      include: true,
      code,
      source: "team_correct_af_id",
      warning: code
        ? undefined
        : `correct_af_id "${correct}" is not a valid AF code; treating as missing`,
    };
  }

  if (decision.startsWith("ok")) {
    const code = normalizeAfCode(proposed);
    return {
      include: true,
      code,
      source: "team_ok_proposed",
      warning: code
        ? undefined
        : `team said OK but proposed_af_id "${proposed}" is not a valid AF code`,
    };
  }

  // No team decision yet: trust only AUTO_MATCHED; skip test accounts.
  if (row.status === "TEST_ACCOUNT") {
    return { include: false, code: null, source: "test_account" };
  }
  if (row.status === "AUTO_MATCHED") {
    const code = normalizeAfCode(proposed);
    return {
      include: true,
      code,
      source: "auto_matched",
      warning: code
        ? undefined
        : `AUTO_MATCHED but proposed_af_id "${proposed}" is not a valid AF code`,
    };
  }
  return { include: true, code: null, source: "unconfirmed" };
}

const HR_SUBJECT_TO_SEAT_ROLE: Record<string, SeatRole> = {
  mathematics: "maths",
  maths: "maths",
  physics: "physics",
  chemistry: "chemistry",
  biology: "biology",
  apc: "apc",
};

// db-service `subject` table ids (en names): 1=Maths, 2=Chemistry, 3=Biology, 4=Physics
const HR_SUBJECT_TO_SUBJECT_ID: Record<string, number> = {
  mathematics: 1,
  maths: 1,
  chemistry: 2,
  biology: 3,
  physics: 4,
};

export function hrSubjectToSeatRole(subject: string | null): SeatRole | null {
  if (!subject) return null;
  return HR_SUBJECT_TO_SEAT_ROLE[subject.trim().toLowerCase()] ?? null;
}

export function hrSubjectToSubjectId(subject: string | null): number | null {
  if (!subject) return null;
  return HR_SUBJECT_TO_SUBJECT_ID[subject.trim().toLowerCase()] ?? null;
}

/**
 * Map a person's school_codes to centres. When one school has multiple
 * centres (only JNV Adilabad today), program_ids break the tie:
 * program 1 = "JNV CoE" -> type_code coe, program 2 = "JNV Nodal" -> nodal.
 */
export function mapSchoolCodesToCentres(
  schoolCodes: string[],
  programIds: number[],
  centresBySchoolCode: Map<string, CentreRef[]>
): { centres: CentreRef[]; ambiguous: CentreRef[][] } {
  const centres: CentreRef[] = [];
  const ambiguous: CentreRef[][] = [];
  const seen = new Set<number>();

  for (const schoolCode of schoolCodes) {
    const candidates = centresBySchoolCode.get(schoolCode) ?? [];
    let resolved: CentreRef[] = candidates;
    if (candidates.length > 1) {
      const wantedType = programIds.includes(1)
        ? "coe"
        : programIds.includes(2)
          ? "nodal"
          : null;
      const tieBroken = candidates.filter((c) => c.typeCode === wantedType);
      if (tieBroken.length === 1) {
        resolved = tieBroken;
      } else {
        ambiguous.push(candidates);
        resolved = [];
      }
    }
    for (const centre of resolved) {
      if (!seen.has(centre.id)) {
        seen.add(centre.id);
        centres.push(centre);
      }
    }
  }

  return { centres, ambiguous };
}

export function parseSheetTsv(content: string): SheetRow[] {
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const col = (prefix: string) =>
    header.findIndex((h) => h.startsWith(prefix));
  const idx = {
    status: col("status"),
    email: col("email"),
    role: col("role"),
    lmsName: col("lms_name"),
    proposedAfId: col("proposed_af_id"),
    teamDecision: col("team_decision"),
    correctAfId: col("correct_af_id"),
  };
  for (const [name, i] of Object.entries(idx)) {
    if (i === -1) throw new Error(`Sheet TSV is missing column: ${name}`);
  }

  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const cell = (i: number) => (cells[i] ?? "").trim();
    return {
      status: cell(idx.status),
      email: cell(idx.email).toLowerCase(),
      role: cell(idx.role),
      lmsName: cell(idx.lmsName),
      proposedAfId: cell(idx.proposedAfId),
      teamDecision: cell(idx.teamDecision),
      correctAfId: cell(idx.correctAfId),
    };
  });
}

// --- Planning ---

interface PermissionRow {
  id: number;
  email: string;
  full_name: string | null;
  role: "teacher" | "program_manager";
  school_codes: string[] | null;
  program_ids: number[] | null;
  user_id: number | null;
}

interface ExistingTeacherRow {
  id: number;
  teacher_id: string | null;
  user_id: number;
  user_email: string | null;
  user_name: string;
}

interface ExistingContext {
  teacherByCode: Map<string, ExistingTeacherRow>;
  afTeacherByName: Map<string, ExistingTeacherRow[]>;
  teacherByUserId: Map<number, ExistingTeacherRow>;
  userIdByEmail: Map<string, number>;
  staffUserIds: Set<number>;
  staffCodes: Set<string>;
  activeSeats: Set<string>; // `${centreId}:${role}:${userId}`
  centresBySchoolCode: Map<string, CentreRef[]>;
}

export function buildPersonPlan(
  person: PermissionRow,
  sheetRow: SheetRow | undefined,
  hrByCode: Map<string, HrEmployee>,
  existing: ExistingContext,
  usedCodes: Map<string, string>
): PersonPlan {
  const fullName = (person.full_name ?? "").trim();
  const warnings: string[] = [];
  const resolution = resolveAfCode(sheetRow);
  if (resolution.warning) warnings.push(resolution.warning);

  const plan: PersonPlan = {
    email: person.email,
    role: person.role,
    fullName,
    code: resolution.code,
    codeSource: resolution.source,
    skipped: false,
    userAction: "create",
    existingUserId: null,
    setEmailOnUser: false,
    teacherAction: "none",
    existingTeacherId: null,
    subjectId: null,
    designation: null,
    staffAction: "none",
    seats: [],
    seatGaps: [],
    warnings,
  };

  if (!resolution.include) {
    plan.skipped = true;
    plan.skipReason = resolution.source as
      | "excluded_by_team"
      | "test_account";
    return plan;
  }

  if (plan.code) {
    const priorEmail = usedCodes.get(plan.code);
    if (priorEmail && priorEmail !== person.email) {
      // Two emails claiming one code is a duplicate-person signal (e.g. a
      // typo'd email row in user_permission) — defer, don't create a dupe.
      warnings.push(
        `AF code ${plan.code} already claimed by ${priorEmail} — likely the same person twice in user_permission; skipping until resolved`
      );
      plan.skipped = true;
      plan.skipReason = "needs_review_duplicate_code";
      return plan;
    }
    usedCodes.set(plan.code, person.email);
  }

  // HR enrichment (subject/designation) only makes sense with a code.
  const hr = plan.code ? hrByCode.get(plan.code) : undefined;
  if (plan.code && !hr) {
    warnings.push(`AF code ${plan.code} not found in the HR employees dump`);
  }
  plan.designation = hr?.designation?.trim() || null;

  // --- Resolve the person to a user row ---
  const existingByCode = plan.code
    ? existing.teacherByCode.get(plan.code)
    : undefined;

  if (person.user_id !== null) {
    plan.userAction = "already_linked";
    plan.existingUserId = person.user_id;
    if (existingByCode && existingByCode.user_id !== person.user_id) {
      warnings.push(
        `user_permission.user_id (${person.user_id}) differs from the user owning teacher code ${plan.code} (user ${existingByCode.user_id})`
      );
    }
  } else if (existingByCode) {
    plan.userAction = "link_by_af_code";
    plan.existingUserId = existingByCode.user_id;
    plan.setEmailOnUser = !existingByCode.user_email;
    if (
      existingByCode.user_email &&
      existingByCode.user_email.toLowerCase() !== person.email
    ) {
      warnings.push(
        `existing teacher ${plan.code} has email ${existingByCode.user_email}, LMS has ${person.email}; keeping the existing email`
      );
    }
  } else if (existing.userIdByEmail.has(person.email)) {
    plan.userAction = "link_by_email";
    plan.existingUserId = existing.userIdByEmail.get(person.email)!;
  } else {
    const nameMatches = fullName
      ? (existing.afTeacherByName.get(normalizeName(fullName)) ?? [])
      : [];
    // Only link by name when it cannot contradict a known code.
    const linkable = nameMatches.filter(
      (t) => !t.teacher_id || t.teacher_id === plan.code
    );
    if (linkable.length === 1) {
      plan.userAction = "link_by_name";
      plan.existingUserId = linkable[0].user_id;
      plan.setEmailOnUser = !linkable[0].user_email;
      warnings.push(
        `linked to existing AF teacher row id=${linkable[0].id} by exact name match ("${fullName}") — verify`
      );
    } else if (nameMatches.length > 0 && !plan.code) {
      // Same name as an AF-coded row, and we have no code to prove they are
      // a different person. Creating would risk a duplicate identity (and a
      // unique-index conflict if the sheet later assigns that code) — defer.
      warnings.push(
        `name "${fullName}" matches existing AF teacher row(s) [${nameMatches
          .map((t) => `id=${t.id} code=${t.teacher_id}`)
          .join(
            ", "
          )}] and no AF code is confirmed; skipping until the sheet decides`
      );
      plan.skipped = true;
      plan.skipReason = "needs_review_name_collision";
      return plan;
    } else {
      if (nameMatches.length > 0) {
        warnings.push(
          `name "${fullName}" matches existing AF teacher row(s) [${nameMatches
            .map((t) => `id=${t.id} code=${t.teacher_id}`)
            .join(", ")}] with a different confirmed code; creating a new row`
        );
      }
      plan.userAction = "create";
    }
  }

  // --- Teacher / staff row ---
  if (person.role === "teacher") {
    plan.subjectId = hrSubjectToSubjectId(hr?.subject ?? null);
    const existingTeacher =
      plan.existingUserId !== null
        ? existing.teacherByUserId.get(plan.existingUserId)
        : undefined;
    if (existingTeacher) {
      plan.teacherAction = "update_existing";
      plan.existingTeacherId = existingTeacher.id;
      if (
        existingTeacher.teacher_id &&
        plan.code &&
        existingTeacher.teacher_id !== plan.code
      ) {
        warnings.push(
          `existing teacher row has code ${existingTeacher.teacher_id}, sheet says ${plan.code}; keeping the existing code`
        );
        plan.code = existingTeacher.teacher_id;
      }
    } else {
      plan.teacherAction = "create";
    }
  } else {
    // program_manager -> staff row (requires employee_code at DB level)
    const alreadyStaff =
      (plan.existingUserId !== null &&
        existing.staffUserIds.has(plan.existingUserId)) ||
      (plan.code !== null && existing.staffCodes.has(plan.code));
    if (alreadyStaff) {
      plan.staffAction = "exists";
    } else if (plan.code) {
      plan.staffAction = "create";
    } else {
      plan.staffAction = "pending_no_code";
    }
  }

  // --- Seats ---
  const { centres, ambiguous } = mapSchoolCodesToCentres(
    person.school_codes ?? [],
    person.program_ids ?? [],
    existing.centresBySchoolCode
  );
  for (const group of ambiguous) {
    plan.seatGaps.push(
      `ambiguous centre for school (candidates: ${group.map((c) => c.name).join(" / ")}) — program_ids do not break the tie`
    );
  }

  if (person.role === "program_manager") {
    for (const centre of centres) {
      plan.seats.push({ centreId: centre.id, centreName: centre.name, role: "pm" });
    }
    if (centres.length === 0 && ambiguous.length === 0) {
      plan.seatGaps.push("no school_codes map to a centre; no pm seat created");
    }
  } else {
    const seatRole = hrSubjectToSeatRole(hr?.subject ?? null);
    if (seatRole === "apc") {
      warnings.push(
        `HR lists ${plan.code} as APC but LMS role is teacher; creating an apc seat`
      );
    }
    if (centres.length === 0) {
      if (ambiguous.length === 0) {
        plan.seatGaps.push("school has no linked centre; no seat created");
      }
    } else if (centres.length > 1) {
      plan.seatGaps.push(
        `school_codes map to ${centres.length} centres (${centres.map((c) => c.name).join(", ")}); teachers get one seat — none created`
      );
    } else if (!seatRole) {
      plan.seatGaps.push(
        hr
          ? `HR subject "${hr.subject ?? ""}" does not map to a seat role; no seat created`
          : plan.code
            ? `AF code ${plan.code} has no HR row to take a subject from; no seat created`
            : "no confirmed AF code, so no HR subject; no seat created"
      );
    } else {
      plan.seats.push({
        centreId: centres[0].id,
        centreName: centres[0].name,
        role: seatRole,
      });
    }
  }

  return plan;
}

// --- Runner ---

export interface BackfillOptions {
  mode: BackfillMode;
  sheetPath: string;
  hrPath: string;
}

export async function runStaffBackfill(
  options: BackfillOptions
): Promise<BackfillReport> {
  const report: BackfillReport = {
    mode: options.mode,
    ok: true,
    counts: {
      sourceTeachers: 0,
      sourcePms: 0,
      skipped: 0,
      usersToCreate: 0,
      usersLinked: 0,
      teachersToCreate: 0,
      teachersLinkedExisting: 0,
      teachersWithCode: 0,
      teachersWithoutCode: 0,
      staffToCreate: 0,
      staffPendingNoCode: 0,
      seatsToCreate: 0,
      seatsExisting: 0,
    },
    plans: [],
    warnings: [],
  };

  let sheetRows: SheetRow[];
  let hrEmployees: HrEmployee[];
  try {
    sheetRows = parseSheetTsv(fs.readFileSync(options.sheetPath, "utf8"));
    hrEmployees = JSON.parse(fs.readFileSync(options.hrPath, "utf8"));
  } catch (error) {
    report.ok = false;
    report.error = `Failed to read inputs: ${error instanceof Error ? error.message : error}`;
    return report;
  }

  const sheetByEmail = new Map(sheetRows.map((r) => [r.email, r]));
  const hrByCode = new Map(
    hrEmployees
      .filter((e) => !e.is_vacant)
      .map((e) => [e.employee_code.trim().toUpperCase(), e])
  );

  const people = await query<PermissionRow>(
    `SELECT id, lower(email) AS email, full_name, role, school_codes, program_ids, user_id
     FROM user_permission
     WHERE role IN ('teacher', 'program_manager') AND revoked_at IS NULL
     ORDER BY role, email`
  );

  // AF-relevant rows only: name-dedupe against the 3k school teachers with
  // phone-style codes would be pure noise.
  const existingTeachers = await query<ExistingTeacherRow>(
    `SELECT t.id, t.teacher_id, t.user_id, u.email AS user_email,
            trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS user_name
     FROM teacher t
     JOIN "user" u ON u.id = t.user_id
     WHERE t.is_af_teacher = true OR t.teacher_id ~ '^AF[0-9]+$'`
  );

  const emails = people.map((p) => p.email);
  const usersByEmail = await query<{ id: number; email: string }>(
    `SELECT id, lower(email) AS email FROM "user" WHERE lower(email) = ANY($1)`,
    [emails]
  );
  const teacherRowsForUsers = await query<ExistingTeacherRow>(
    `SELECT t.id, t.teacher_id, t.user_id, u.email AS user_email,
            trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS user_name
     FROM teacher t JOIN "user" u ON u.id = t.user_id
     WHERE t.user_id = ANY($2) OR lower(u.email) = ANY($1)`,
    [emails, people.map((p) => p.user_id).filter((id) => id !== null)]
  );

  const staffRows = await query<{ user_id: number; employee_code: string }>(
    `SELECT user_id, employee_code FROM staff`
  );
  const seatRows = await query<{
    centre_id: number;
    role: string;
    user_id: number | null;
  }>(
    `SELECT centre_id, role, user_id FROM centre_positions WHERE deleted_at IS NULL`
  );
  const centreRows = await query<{
    id: number;
    name: string;
    type_code: string | null;
    school_code: string;
  }>(
    `SELECT c.id, c.name, c.type_code, s.code AS school_code
     FROM centres c JOIN school s ON s.id = c.school_id
     WHERE c.is_active = true`
  );

  const existing: ExistingContext = {
    teacherByCode: new Map(),
    afTeacherByName: new Map(),
    teacherByUserId: new Map(),
    userIdByEmail: new Map(usersByEmail.map((u) => [u.email, Number(u.id)])),
    staffUserIds: new Set(staffRows.map((s) => Number(s.user_id))),
    staffCodes: new Set(staffRows.map((s) => s.employee_code)),
    activeSeats: new Set(
      seatRows
        .filter((s) => s.user_id !== null)
        .map((s) => `${s.centre_id}:${s.role}:${s.user_id}`)
    ),
    centresBySchoolCode: new Map(),
  };
  for (const t of existingTeachers) {
    const row = { ...t, id: Number(t.id), user_id: Number(t.user_id) };
    if (t.teacher_id) existing.teacherByCode.set(t.teacher_id, row);
    const key = normalizeName(t.user_name);
    if (key) {
      const list = existing.afTeacherByName.get(key) ?? [];
      list.push(row);
      existing.afTeacherByName.set(key, list);
    }
    existing.teacherByUserId.set(row.user_id, row);
  }
  for (const t of teacherRowsForUsers) {
    existing.teacherByUserId.set(Number(t.user_id), {
      ...t,
      id: Number(t.id),
      user_id: Number(t.user_id),
    });
  }
  for (const c of centreRows) {
    const ref: CentreRef = {
      id: Number(c.id),
      name: c.name,
      typeCode: c.type_code,
      schoolCode: c.school_code,
    };
    const list = existing.centresBySchoolCode.get(c.school_code) ?? [];
    list.push(ref);
    existing.centresBySchoolCode.set(c.school_code, list);
  }

  const usedCodes = new Map<string, string>();
  for (const person of people) {
    const plan = buildPersonPlan(
      { ...person, id: Number(person.id), user_id: person.user_id === null ? null : Number(person.user_id) },
      sheetByEmail.get(person.email),
      hrByCode,
      existing,
      usedCodes
    );
    report.plans.push(plan);
    tallyPlan(report, plan, existing);
  }

  if (options.mode === "apply") {
    try {
      await withTransaction(async (client) => {
        for (const plan of report.plans) {
          if (!plan.skipped) await applyPlan(client, plan, people, existing);
        }
      });
    } catch (error) {
      report.ok = false;
      report.error = `Apply failed (rolled back): ${error instanceof Error ? error.message : error}`;
    }
  }

  return report;
}

function tallyPlan(
  report: BackfillReport,
  plan: PersonPlan,
  existing: ExistingContext
): void {
  const c = report.counts;
  if (plan.role === "teacher") c.sourceTeachers++;
  else c.sourcePms++;
  if (plan.skipped) {
    c.skipped++;
    return;
  }
  if (plan.userAction === "create") c.usersToCreate++;
  else c.usersLinked++;
  if (plan.role === "teacher") {
    if (plan.teacherAction === "create") c.teachersToCreate++;
    else c.teachersLinkedExisting++;
    if (plan.code) c.teachersWithCode++;
    else c.teachersWithoutCode++;
  }
  if (plan.staffAction === "create") c.staffToCreate++;
  if (plan.staffAction === "pending_no_code") c.staffPendingNoCode++;
  for (const seat of plan.seats) {
    const known =
      plan.existingUserId !== null &&
      existing.activeSeats.has(
        `${seat.centreId}:${seat.role}:${plan.existingUserId}`
      );
    if (known) c.seatsExisting++;
    else c.seatsToCreate++;
  }
  report.warnings.push(
    ...plan.warnings.map((w) => `${plan.email}: ${w}`),
    ...plan.seatGaps.map((g) => `${plan.email}: ${g}`)
  );
}

async function applyPlan(
  client: PoolClient,
  plan: PersonPlan,
  people: PermissionRow[],
  existing: ExistingContext
): Promise<void> {
  const person = people.find(
    (p) => p.email === plan.email && p.role === plan.role
  )!;

  // 1. User row
  let userId = plan.existingUserId;
  if (userId === null) {
    const { firstName, lastName } = splitFullName(plan.fullName);
    const inserted = await client.query(
      `INSERT INTO "user" (first_name, last_name, email, inserted_at, updated_at)
       VALUES ($1, $2, $3, now(), now()) RETURNING id`,
      [firstName || null, lastName, plan.email]
    );
    userId = Number(inserted.rows[0].id);
  } else if (plan.setEmailOnUser) {
    await client.query(
      `UPDATE "user" SET email = $1, updated_at = now()
       WHERE id = $2 AND (email IS NULL OR email = '')`,
      [plan.email, userId]
    );
  }

  // 2. Teacher / staff row
  if (plan.teacherAction === "create") {
    await client.query(
      `INSERT INTO teacher (user_id, teacher_id, is_af_teacher, subject_id, designation, inserted_at, updated_at)
       VALUES ($1, $2, true, $3, $4, now(), now())`,
      [userId, plan.code, plan.subjectId, plan.designation]
    );
  } else if (plan.teacherAction === "update_existing") {
    await client.query(
      `UPDATE teacher
       SET teacher_id = COALESCE(teacher_id, $1),
           is_af_teacher = true,
           subject_id = COALESCE(subject_id, $2),
           designation = COALESCE(designation, $3),
           updated_at = now()
       WHERE id = $4`,
      [plan.code, plan.subjectId, plan.designation, plan.existingTeacherId]
    );
  }
  if (plan.staffAction === "create") {
    await client.query(
      `INSERT INTO staff (user_id, employee_code, staff_type, designation, inserted_at, updated_at)
       VALUES ($1, $2, 'program_manager', $3, now(), now())`,
      [userId, plan.code, plan.designation]
    );
  }

  // 3. user_permission link
  await client.query(
    `UPDATE user_permission SET user_id = $1, updated_at = now()
     WHERE id = $2 AND (user_id IS NULL OR user_id = $1)`,
    [userId, person.id]
  );

  // 4. Seats (skip ones that already exist for this user). Reuse the
  // pre-loaded activeSeats set instead of a per-seat SELECT (the same set
  // tallyPlan counts against), and add freshly-inserted keys so a later plan
  // for the same user can't double-insert within this transaction.
  for (const seat of plan.seats) {
    const seatKey = `${seat.centreId}:${seat.role}:${userId}`;
    if (!existing.activeSeats.has(seatKey)) {
      await client.query(
        `INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at)
         VALUES ($1, $2, $3, now(), now())`,
        [seat.centreId, seat.role, userId]
      );
      existing.activeSeats.add(seatKey);
    }
  }
}
