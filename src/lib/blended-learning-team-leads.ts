import type { PoolClient } from "pg";

import { query, withTransaction } from "./db";
import {
  canBlendedLearning,
  liveBlendedMentorSql,
  permissionUserIdSql,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import type { FieldErrors } from "./blended-learning-manage-input";
import { BLENDED_MENTOR_ROLE, CURRENT_ACADEMIC_YEAR } from "./constants";

// The Manage page's Team leads (server-only): Blended Learning Admins who may
// `manage` list, start and end Supervisions (blended_learning_mentor_supervisions)
// for the current academic year without SQL. A team lead (the supervisor)
// lands on cards for themselves and the Mentors they lead, and views those
// Mentors' Students read-only. Writes are recorded as from the Manage page
// with the admin's email; a Supervision is ended, never deleted.

// `email` (the `user` row's) is shown on the Manage page (admins only) only
// to tell apart Mentors who share a display name.
export type TeamLeadPerson = { userId: number; name: string; email: string | null };
// `isMentor`: still a live Blended Learning Mentor (liveBlendedMentorSql). A
// Supervision with either side no longer one stays listed (so it can be
// ended) but has no effect: the access check skips it.
export type TeamLeadLinkPerson = TeamLeadPerson & { isMentor: boolean };
export type TeamLeadLink = { id: number; teamLead: TeamLeadLinkPerson; reportee: TeamLeadLinkPerson; startedOn: string };

export type TeamLeadResult =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 409 | 422; error: string; fieldErrors?: FieldErrors };

const TEAM_LEAD_SOURCE = "af_lms_manage_ui";
const END_REASON = "supervision_ended";

const FORBIDDEN: TeamLeadResult = { ok: false, status: 403, error: "Forbidden" };
const NOT_FOUND: TeamLeadResult = { ok: false, status: 404, error: "Not found" };

// A person's display name: full name, else email, else "Mentor <id>".
const NAME_SQL = (alias: string) =>
  `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), ''), ${alias}.email, CONCAT('Mentor ', ${alias}.id))`;

// Blended Learning Mentors' `user` ids: every live (not revoked)
// blended_mentor permission ($1), resolved as the app resolves a Mentor
// (permissionUserIdSql). Mappings alone do not make someone a Mentor: one who
// has left keeps their Mappings until they are moved.
const BLENDED_MENTOR_IDS_SQL = `
  SELECT DISTINCT ${permissionUserIdSql("permission")} AS id
  FROM user_permission permission
  WHERE permission.role = $1 AND permission.revoked_at IS NULL`;

async function blendedMentors(): Promise<TeamLeadPerson[]> {
  const rows = await query<{ id: number | string; name: string; email: string | null }>(
    `SELECT mentor.id, ${NAME_SQL("mentor")} AS name, mentor.email
     FROM (${BLENDED_MENTOR_IDS_SQL}) mentors
     JOIN "user" mentor ON mentor.id = mentors.id
     ORDER BY name, mentor.id`,
    [BLENDED_MENTOR_ROLE]
  );
  return rows.map((row) => ({ userId: Number(row.id), name: row.name, email: row.email }));
}

// Who can be a team lead or a reportee, A–Z.
export async function listBlendedMentorOptions(access: BlendedLearningAccess): Promise<TeamLeadPerson[]> {
  if (!canBlendedLearning(access, "manage")) return [];
  return blendedMentors();
}

type LinkRow = {
  id: number | string;
  supervisor_user_id: number | string;
  supervisor_name: string;
  supervisor_email: string | null;
  mentor_user_id: number | string;
  mentor_name: string;
  mentor_email: string | null;
  supervisor_is_mentor: boolean;
  mentor_is_mentor: boolean;
  started_on: string;
};

// The running (not ended) current-year Supervisions, by team lead then
// reportee, each with whether the lead and the reportee are still live
// Mentors, so the page can say why one has no effect. A future-dated one
// (import sheet only) is listed too, as it holds the pair's slot and can be
// ended; the access check skips it until it starts.
export async function listTeamLeadLinks(access: BlendedLearningAccess): Promise<TeamLeadLink[]> {
  if (!canBlendedLearning(access, "manage")) return [];
  const rows = await query<LinkRow>(
    `SELECT supervision.id, supervision.supervisor_user_id, ${NAME_SQL("lead")} AS supervisor_name,
            lead.email AS supervisor_email,
            supervision.mentor_user_id, ${NAME_SQL("reportee")} AS mentor_name, reportee.email AS mentor_email,
            ${liveBlendedMentorSql("supervision.supervisor_user_id", "$2")} AS supervisor_is_mentor,
            ${liveBlendedMentorSql("supervision.mentor_user_id", "$2")} AS mentor_is_mentor,
            ((supervision.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS started_on
     FROM blended_learning_mentor_supervisions supervision
     JOIN "user" lead ON lead.id = supervision.supervisor_user_id
     JOIN "user" reportee ON reportee.id = supervision.mentor_user_id
     WHERE supervision.academic_year = $1 AND supervision.ended_at IS NULL
     ORDER BY supervisor_name, mentor_name, supervision.id`,
    [CURRENT_ACADEMIC_YEAR, BLENDED_MENTOR_ROLE]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    teamLead: {
      userId: Number(row.supervisor_user_id),
      name: row.supervisor_name,
      email: row.supervisor_email,
      isMentor: row.supervisor_is_mentor === true,
    },
    reportee: {
      userId: Number(row.mentor_user_id),
      name: row.mentor_name,
      email: row.mentor_email,
      isMentor: row.mentor_is_mentor === true,
    },
    startedOn: row.started_on,
  }));
}

type Pair = { supervisorUserId: number; mentorUserId: number };

function positiveId(value: unknown): number | null {
  const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

function invalid(fieldErrors: FieldErrors): TeamLeadResult {
  return { ok: false, status: 422, error: Object.values(fieldErrors)[0], fieldErrors };
}

// The body's two ids, or the field errors: both chosen, and not the same person.
function parsePair(raw: unknown): { ok: true; pair: Pair } | { ok: false; fieldErrors: FieldErrors } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const supervisorUserId = positiveId(body.supervisorUserId);
  const mentorUserId = positiveId(body.mentorUserId);
  const errors: FieldErrors = {};
  if (supervisorUserId === null) errors.supervisorUserId = "Choose a team lead.";
  if (mentorUserId === null) errors.mentorUserId = "Choose the mentor they lead.";
  else if (mentorUserId === supervisorUserId) errors.mentorUserId = "Choose someone other than the team lead.";
  if (supervisorUserId === null || mentorUserId === null || Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  return { ok: true, pair: { supervisorUserId, mentorUserId } };
}

// Inside the insert's transaction: which of the pair are not live Blended
// Learning Mentors. Their permission rows are locked FOR SHARE, so a revoke
// waits for the insert (or the insert sees the revoke): no check-then-act gap.
async function notMentors(client: PoolClient, pair: Pair): Promise<FieldErrors | null> {
  const result = await client.query<{ id: number | string | null }>(
    `SELECT ${permissionUserIdSql("permission")} AS id
     FROM user_permission permission
     WHERE permission.role = $1 AND permission.revoked_at IS NULL
       AND ${permissionUserIdSql("permission")} = ANY($2::bigint[])
     FOR SHARE OF permission`,
    [BLENDED_MENTOR_ROLE, [pair.supervisorUserId, pair.mentorUserId]]
  );
  const found = new Set(result.rows.map((row) => Number(row.id)));
  const errors: FieldErrors = {};
  if (!found.has(pair.supervisorUserId)) errors.supervisorUserId = "Choose a Blended Learning mentor.";
  if (!found.has(pair.mentorUserId)) errors.mentorUserId = "Choose a Blended Learning mentor.";
  return Object.keys(errors).length > 0 ? errors : null;
}

// Starts the pair's Supervision for the current academic year, as from the
// Manage page by the admin; 0 when the pair already runs one (the active-pair
// unique index), else 1.
async function insertSupervision(client: PoolClient, pair: Pair, actorEmail: string): Promise<number> {
  const result = await client.query(
    `INSERT INTO blended_learning_mentor_supervisions
       (supervisor_user_id, mentor_user_id, academic_year, started_at,
        assigned_by_email, assignment_source, assignment_audit_reason)
     VALUES ($1, $2, $3, date_trunc('second', now() AT TIME ZONE 'UTC'), $4, $5, $6)
     ON CONFLICT (supervisor_user_id, mentor_user_id, academic_year) WHERE ended_at IS NULL DO NOTHING
     RETURNING id`,
    [pair.supervisorUserId, pair.mentorUserId, CURRENT_ACADEMIC_YEAR, actorEmail, TEAM_LEAD_SOURCE, null]
  );
  return result.rows.length;
}

// Starts a team lead's Supervision of a Mentor; a 409 when it already runs.
export async function createTeamLeadLink(access: BlendedLearningAccess, raw: unknown): Promise<TeamLeadResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  const parsed = parsePair(raw);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  // Field errors when either is not a live Mentor, else the rows inserted.
  const outcome = await withTransaction(async (client) => {
    const people = await notMentors(client, parsed.pair);
    return people ?? (await insertSupervision(client, parsed.pair, access.actorEmail));
  });
  if (typeof outcome !== "number") return invalid(outcome);
  if (outcome === 0) return { ok: false, status: 409, error: "This team lead already leads this mentor." };
  return { ok: true };
}

// Ends a running current-year Supervision by its id, in one conditional
// UPDATE, so a pair ended and started again meanwhile keeps its new row; a 404
// when that row is not running (ended already, another year, or no such id).
export async function endTeamLeadLink(access: BlendedLearningAccess, id: number): Promise<TeamLeadResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  if (!Number.isSafeInteger(id) || id <= 0) return NOT_FOUND;
  const rows = await query<{ id: number | string }>(
    `UPDATE blended_learning_mentor_supervisions
     SET ended_at = GREATEST(started_at, date_trunc('second', now() AT TIME ZONE 'UTC')),
         ended_by_email = $3, end_source = $4, end_reason = $5, end_audit_reason = NULL, updated_at = now()
     WHERE id = $1 AND academic_year = $2 AND ended_at IS NULL
     RETURNING id`,
    [id, CURRENT_ACADEMIC_YEAR, access.actorEmail, TEAM_LEAD_SOURCE, END_REASON]
  );
  return rows.length === 0 ? NOT_FOUND : { ok: true };
}
