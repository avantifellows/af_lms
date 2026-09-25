import type { PoolClient } from "pg";
import { NextResponse } from "next/server";

import { query } from "./db";
import {
  INTERVENTION_FLAG_NOTE_MAX_LENGTH,
  type InterventionFlag,
  type InterventionFlagStatus,
  type InterventionFlagUpdate,
  type OpenInterventionFlagSummary,
} from "./intervention-flag-types";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getResolvedPermission,
  type UserPermission,
} from "./permissions";

// Intervention flags: a Teacher (or PM/Admin) flags a Student who needs special,
// non-academic intervention — medical, mental health, grief, extra attention —
// with a note. A flag is the case; every change to it is an append-only update
// row (raise, follow-up note, resolve). Tables are LMS-owned, created by the
// db-service migration `create_lms_student_intervention_flags`.
//
// Every school-scoped read and write goes through `authorizeInterventionFlags`
// below (the cross-school list is admin-only, behind `requireAdmin`), so a later narrowing (e.g. for
// mental-health notes) is a change in one place.

export {
  INTERVENTION_FLAG_NOTE_MAX_LENGTH,
  type InterventionFlag,
  type InterventionFlagStatus,
  type InterventionFlagUpdate,
  type OpenInterventionFlagSummary,
} from "./intervention-flag-types";

export interface InterventionFlagActor {
  email: string;
  userId: number | null;
  permission: UserPermission;
}

export interface InterventionFlagSchool {
  id: string;
  code: string;
  udise_code: string | null;
  name: string;
  region: string | null;
}

interface SessionLike {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
}

type AuthResult<T> = ({ ok: true } & T) | { ok: false; response: NextResponse };

function deny(status: number, error: string): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

// Rule: anyone who can see a Student (school access + `students` view) can
// flag them, add notes and resolve. Passcode logins are excluded: a passcode is
// shared by a whole school, so it cannot attribute a note to a person.
async function resolveActor(
  session: SessionLike | null,
): Promise<AuthResult<{ actor: InterventionFlagActor }>> {
  if (!session) return deny(401, "Unauthorized");
  const email = session.user?.email;
  if (session.isPasscodeUser || !email) return deny(403, "Forbidden");

  const permission = await getResolvedPermission(email);
  if (!permission || !getFeatureAccess(permission, "students").canView) {
    return deny(403, "Forbidden");
  }

  return {
    ok: true,
    actor: {
      email,
      userId: permission.user_id != null ? Number(permission.user_id) : null,
      permission,
    },
  };
}

/** Gate for school-scoped flag routes. `schoolKey` is a UDISE code or school code. */
export async function authorizeInterventionFlags(
  session: SessionLike | null,
  schoolKey: string,
): Promise<AuthResult<{ actor: InterventionFlagActor; school: InterventionFlagSchool }>> {
  const actorResult = await resolveActor(session);
  if (!actorResult.ok) return actorResult;

  const schools = await query<InterventionFlagSchool>(
    `SELECT id, code, udise_code, name, region FROM school WHERE udise_code = $1 OR code = $1`,
    [schoolKey],
  );
  const school = schools[0];
  if (!school) return deny(404, "School not found");

  if (!canAccessSchoolSync(actorResult.actor.permission, school.code, school.region ?? undefined)) {
    return deny(403, "Forbidden");
  }
  return { ok: true, actor: actorResult.actor, school };
}

/** Pure check used by server components to decide whether to render flag UI. */
export function canUseInterventionFlags(
  permission: UserPermission | null,
  opts?: { isPasscodeUser?: boolean },
): boolean {
  if (opts?.isPasscodeUser) return false;
  return getFeatureAccess(permission, "students").canView;
}

export type NoteValidation = { ok: true; note: string } | { ok: false; error: string };

export function validateNote(raw: unknown, { required }: { required: boolean }): NoteValidation {
  if (raw != null && typeof raw !== "string") return { ok: false, error: "note must be a string" };
  const note = (raw ?? "").trim();
  if (required && note.length === 0) return { ok: false, error: "A note is required" };
  if (note.length > INTERVENTION_FLAG_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Note must be at most ${INTERVENTION_FLAG_NOTE_MAX_LENGTH} characters`,
    };
  }
  return { ok: true, note };
}

// Timestamp columns are `timestamp without time zone` holding UTC. node-pg would
// read them as the Node process's local time, so every read converts them to
// timestamptz with `AT TIME ZONE 'UTC'`.
const UPDATE_COLUMNS = `
  upd.id::int AS id,
  upd.author_email,
  NULLIF(TRIM(up.full_name), '') AS author_name,
  upd.body,
  upd.status_from,
  upd.status_to,
  upd.inserted_at AT TIME ZONE 'UTC' AS inserted_at`;

// Name lookup by email: permission-only admins have no "user" row, but every
// author has a user_permission row. A scalar subquery avoids row duplication
// when an email has case-variant duplicate permission rows.
const AUTHOR_NAME_JOIN = `
  LEFT JOIN LATERAL (
    SELECT full_name FROM user_permission
    WHERE LOWER(email) = LOWER(upd.author_email)
    ORDER BY id LIMIT 1
  ) up ON true`;

/** Every flag (open and resolved) raised at a school, with its update history. */
export async function listSchoolFlags(schoolId: string): Promise<InterventionFlag[]> {
  const flags = await query<Omit<InterventionFlag, "updates">>(
    `SELECT f.id::int AS id, f.student_id::text AS student_pk_id, f.status,
            f.raised_by_email,
            f.inserted_at AT TIME ZONE 'UTC' AS inserted_at,
            f.resolved_at AT TIME ZONE 'UTC' AS resolved_at
     FROM lms_student_intervention_flags f
     WHERE f.school_id = $1
     ORDER BY f.inserted_at DESC`,
    [schoolId],
  );
  if (flags.length === 0) return [];

  const updates = await query<InterventionFlagUpdate & { flag_id: number }>(
    `SELECT upd.flag_id::int AS flag_id, ${UPDATE_COLUMNS}
     FROM lms_student_intervention_flag_updates upd
     ${AUTHOR_NAME_JOIN}
     WHERE upd.flag_id = ANY($1::bigint[])
     ORDER BY upd.inserted_at, upd.id`,
    [flags.map((f) => f.id)],
  );

  const byFlag = new Map<number, InterventionFlagUpdate[]>();
  for (const { flag_id, ...update } of updates) {
    const list = byFlag.get(flag_id) ?? [];
    list.push(update);
    byFlag.set(flag_id, list);
  }
  return flags.map((f) => ({ ...f, updates: byFlag.get(f.id) ?? [] }));
}

/** Open flags across every school the actor can see, newest activity first. */
export async function listOpenFlags(
  schoolCodes: "all" | string[],
): Promise<OpenInterventionFlagSummary[]> {
  if (schoolCodes !== "all" && schoolCodes.length === 0) return [];
  return query<OpenInterventionFlagSummary>(
    `SELECT f.id::int AS id,
            f.student_id::text AS student_pk_id,
            TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS student_name,
            sch.code AS school_code,
            sch.udise_code AS school_udise,
            sch.name AS school_name,
            f.raised_by_email,
            f.inserted_at AT TIME ZONE 'UTC' AS inserted_at,
            latest.body AS latest_note,
            latest.inserted_at AT TIME ZONE 'UTC' AS latest_at
     FROM lms_student_intervention_flags f
     JOIN school sch ON sch.id = f.school_id
     JOIN student s ON s.id = f.student_id
     JOIN "user" u ON u.id = s.user_id
     JOIN LATERAL (
       SELECT upd.body, upd.inserted_at
       FROM lms_student_intervention_flag_updates upd
       WHERE upd.flag_id = f.id
       ORDER BY upd.inserted_at DESC, upd.id DESC
       LIMIT 1
     ) latest ON true
     WHERE f.status = 'open'
       AND ($1::text[] IS NULL OR sch.code = ANY($1::text[]))
     ORDER BY latest.inserted_at DESC`,
    [schoolCodes === "all" ? null : schoolCodes],
  );
}

export class InterventionFlagError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

/**
 * Raise a flag on a Student with its first note. The caller has already checked
 * that the Student belongs to `schoolId`. Refuses (409) when the Student already
 * has an open flag; follow-ups go on that flag instead.
 */
export async function raiseFlag(
  client: PoolClient,
  params: {
    studentPkId: number;
    schoolId: string;
    programId: number | null;
    actor: InterventionFlagActor;
    note: string;
  },
): Promise<{ id: number }> {
  let flagId: number;
  try {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO lms_student_intervention_flags
         (student_id, school_id, program_id, status, raised_by_email, raised_by_user_id)
       VALUES ($1, $2, $3, 'open', $4, $5)
       RETURNING id::int AS id`,
      [
        params.studentPkId,
        params.schoolId,
        params.programId,
        params.actor.email.toLowerCase(),
        params.actor.userId,
      ],
    );
    flagId = rows[0].id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InterventionFlagError(409, "This student already has an open flag");
    }
    throw error;
  }

  await client.query(
    `INSERT INTO lms_student_intervention_flag_updates
       (flag_id, author_email, author_user_id, body, status_from, status_to)
     VALUES ($1, $2, $3, $4, NULL, 'open')`,
    [flagId, params.actor.email.toLowerCase(), params.actor.userId, params.note],
  );
  return { id: flagId };
}

/**
 * Add a follow-up note to a flag at `schoolId`, optionally resolving it. A note
 * is required unless resolving. Resolving an already-resolved flag is a 409.
 */
export async function addFlagUpdate(
  client: PoolClient,
  params: {
    flagId: number;
    schoolId: string;
    actor: InterventionFlagActor;
    note: string;
    resolve: boolean;
  },
): Promise<{ status: InterventionFlagStatus }> {
  const { rows } = await client.query<{ status: InterventionFlagStatus }>(
    `SELECT status FROM lms_student_intervention_flags
     WHERE id = $1 AND school_id = $2
     FOR UPDATE`,
    [params.flagId, params.schoolId],
  );
  const flag = rows[0];
  if (!flag) throw new InterventionFlagError(404, "Flag not found");
  if (params.resolve && flag.status !== "open") {
    throw new InterventionFlagError(409, "This flag is already resolved");
  }

  const statusTo: InterventionFlagStatus | null = params.resolve ? "resolved" : null;
  if (params.resolve) {
    await client.query(
      `UPDATE lms_student_intervention_flags
       SET status = 'resolved', resolved_at = now(), updated_at = now()
       WHERE id = $1`,
      [params.flagId],
    );
  } else {
    await client.query(
      `UPDATE lms_student_intervention_flags SET updated_at = now() WHERE id = $1`,
      [params.flagId],
    );
  }

  await client.query(
    `INSERT INTO lms_student_intervention_flag_updates
       (flag_id, author_email, author_user_id, body, status_from, status_to)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.flagId,
      params.actor.email.toLowerCase(),
      params.actor.userId,
      params.note || null,
      params.resolve ? flag.status : null,
      statusTo,
    ],
  );
  return { status: statusTo ?? flag.status };
}
