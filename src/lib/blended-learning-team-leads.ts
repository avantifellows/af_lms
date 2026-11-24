import type { PoolClient } from "pg";

import { query, withTransaction } from "./db";
import {
  canBlendedLearning,
  liveBlendedMentorSql,
  permissionUserIdSql,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import type { FieldErrors } from "./blended-learning-manage-input";
import { formatCalendarDate } from "./blended-learning-format";
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
// `endsOn`: the IST date a link given a future end (outside the app, e.g. by
// db-service) stops, or null for one that runs until it is ended.
export type TeamLeadLink = {
  id: number;
  teamLead: TeamLeadLinkPerson;
  reportee: TeamLeadLinkPerson;
  startedOn: string;
  endsOn: string | null;
};

export type TeamLeadResult =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 409 | 422; error: string; fieldErrors?: FieldErrors };

const TEAM_LEAD_SOURCE = "af_lms_manage_ui";
const END_REASON = "supervision_ended";

const ALREADY_LEADS = "This team lead already leads this mentor.";

// A link is still in force or yet to come: not ended, or ended in the future
// (it grants until then, blended-learning-access's period rule). These are the
// links the Manage page lists and can end. UTC, like the columns.
const NOT_YET_ENDED_SQL = (alias: string) =>
  `(${alias}.ended_at IS NULL OR ${alias}.ended_at > (now() AT TIME ZONE 'UTC'))`;

// A UTC timestamp column as its IST calendar date, `YYYY-MM-DD`.
const IST_DATE_SQL = (column: string) => `((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text`;

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
  ended_on: string | null;
};

// The current-year Supervisions not yet ended (running, or given a future
// end), by team lead then reportee, each with whether the lead and the
// reportee are still live Mentors, so the page can say why one has no effect,
// and when one given a future end stops. A future-dated one (import sheet
// only) is listed too, as it holds the pair's slot and can be ended; the
// access check skips it until it starts.
export async function listTeamLeadLinks(access: BlendedLearningAccess): Promise<TeamLeadLink[]> {
  if (!canBlendedLearning(access, "manage")) return [];
  const rows = await query<LinkRow>(
    `SELECT supervision.id, supervision.supervisor_user_id, ${NAME_SQL("lead")} AS supervisor_name,
            lead.email AS supervisor_email,
            supervision.mentor_user_id, ${NAME_SQL("reportee")} AS mentor_name, reportee.email AS mentor_email,
            ${liveBlendedMentorSql("supervision.supervisor_user_id", "$2")} AS supervisor_is_mentor,
            ${liveBlendedMentorSql("supervision.mentor_user_id", "$2")} AS mentor_is_mentor,
            ${IST_DATE_SQL("supervision.started_at")} AS started_on,
            ${IST_DATE_SQL("supervision.ended_at")} AS ended_on
     FROM blended_learning_mentor_supervisions supervision
     JOIN "user" lead ON lead.id = supervision.supervisor_user_id
     JOIN "user" reportee ON reportee.id = supervision.mentor_user_id
     WHERE supervision.academic_year = $1 AND ${NOT_YET_ENDED_SQL("supervision")}
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
    endsOn: row.ended_on ?? null,
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

const NO_OVERLAP_CONSTRAINT = "blm_supervisions_no_overlapping_periods";

// Postgres exclusion_violation (23P01) on db-service's
// blm_supervisions_no_overlapping_periods, which keeps a pair's [started_at,
// ended_at) periods in a year from overlapping. The insert hits it instead of
// the ON CONFLICT when the pair has a link given a future end, or when two
// adds race: either way the pair already has a link in force. Any other
// constraint is not this, and still throws.
function isOverlappingPeriod(error: unknown): boolean {
  const pg = error as { code?: unknown; constraint?: unknown } | null;
  return pg?.code === "23P01" && pg.constraint === NO_OVERLAP_CONSTRAINT;
}

// The 409 for a pair that already has a link in force: when that link was
// given a future end, says when it ends (so the admin can find it on the list
// or add the pair again from then); else the plain "already leads".
async function alreadyLeads(pair: Pair): Promise<TeamLeadResult> {
  const rows = await query<{ ended_on: string | null }>(
    `SELECT ${IST_DATE_SQL("supervision.ended_at")} AS ended_on
     FROM blended_learning_mentor_supervisions supervision
     WHERE supervision.supervisor_user_id = $1 AND supervision.mentor_user_id = $2
       AND supervision.academic_year = $3 AND ${NOT_YET_ENDED_SQL("supervision")}
     ORDER BY supervision.ended_at DESC NULLS FIRST
     LIMIT 1`,
    [pair.supervisorUserId, pair.mentorUserId, CURRENT_ACADEMIC_YEAR]
  );
  const endsOn = rows[0]?.ended_on;
  const error = endsOn
    ? `This team lead already leads this mentor until ${formatCalendarDate(endsOn)}.`
    : ALREADY_LEADS;
  return { ok: false, status: 409, error };
}

// Starts a team lead's Supervision of a Mentor; a 409 when it already runs.
export async function createTeamLeadLink(access: BlendedLearningAccess, raw: unknown): Promise<TeamLeadResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  const parsed = parsePair(raw);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  // Field errors when either is not a live Mentor, else the rows inserted. An
  // overlapping period is caught outside the transaction, so it has rolled
  // back before the clashing link is looked up.
  let outcome: FieldErrors | number;
  try {
    outcome = await withTransaction(async (client) => {
      const people = await notMentors(client, parsed.pair);
      return people ?? (await insertSupervision(client, parsed.pair, access.actorEmail));
    });
  } catch (error) {
    if (!isOverlappingPeriod(error)) throw error;
    return alreadyLeads(parsed.pair);
  }
  if (typeof outcome !== "number") return invalid(outcome);
  if (outcome === 0) return { ok: false, status: 409, error: ALREADY_LEADS };
  return { ok: true };
}

// Ends a current-year Supervision not yet ended by its id, now (or at its
// start, if that is later), in one conditional UPDATE, so a pair ended and
// started again meanwhile keeps its new row; a 404 when that row has already
// ended (or is another year's, or no such id). A link given a future end is
// cut short: its end moves forward to now and the record names the admin and
// the Manage page as who ended it, replacing the earlier planned end's. An
// end already past is never touched, and the end only ever moves earlier.
export async function endTeamLeadLink(access: BlendedLearningAccess, id: number): Promise<TeamLeadResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  if (!Number.isSafeInteger(id) || id <= 0) return NOT_FOUND;
  const rows = await query<{ id: number | string }>(
    `UPDATE blended_learning_mentor_supervisions
     SET ended_at = GREATEST(started_at, date_trunc('second', now() AT TIME ZONE 'UTC')),
         ended_by_user_id = NULL, ended_by_email = $3, end_source = $4, end_reason = $5, end_audit_reason = NULL,
         updated_at = now()
     WHERE id = $1 AND academic_year = $2 AND ${NOT_YET_ENDED_SQL("blended_learning_mentor_supervisions")}
     RETURNING id`,
    [id, CURRENT_ACADEMIC_YEAR, access.actorEmail, TEAM_LEAD_SOURCE, END_REASON]
  );
  return rows.length === 0 ? NOT_FOUND : { ok: true };
}
