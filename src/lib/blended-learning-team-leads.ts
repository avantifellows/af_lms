import { query, withTransaction } from "./db";
import { activeBlendedMappingSql, canBlendedLearning, type BlendedLearningAccess } from "./blended-learning-access";
import type { FieldErrors } from "./blended-learning-manage-input";
import { insertSupervision, type SupervisionAudit } from "./blended-learning-supervisions-load";
import { BLENDED_MENTOR_ROLE, CURRENT_ACADEMIC_YEAR } from "./constants";

// The Manage page's Team leads (server-only): Blended Learning Admins who may
// `manage` list, start and end Supervisions (blended_learning_mentor_supervisions)
// for the current academic year without SQL. A team lead (the supervisor)
// lands on cards for themselves and the Mentors they lead, and views those
// Mentors' Students read-only. Writes are recorded as from the Manage page
// with the admin's email; a Supervision is ended, never deleted.

export type TeamLeadPerson = { userId: number; name: string };
export type TeamLeadLink = { id: number; teamLead: TeamLeadPerson; reportee: TeamLeadPerson; startedOn: string };

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

// Blended Learning Mentors' `user` ids: every Mentor with an active
// current-year Mapping ($1), and every live blended_mentor permission ($2),
// resolved as the app resolves a Mentor (user_permission.user_id, else the
// lowest-id `user` with that email).
const BLENDED_MENTOR_IDS_SQL = `
  SELECT mapping.mentor_user_id AS id
  FROM blended_learning_mentor_mentee_mappings mapping
  WHERE ${activeBlendedMappingSql("mapping", "$1")}
  UNION
  SELECT COALESCE(permission.user_id,
                  (SELECT account.id FROM "user" account
                   WHERE LOWER(account.email) = LOWER(permission.email) ORDER BY account.id LIMIT 1))
  FROM user_permission permission
  WHERE permission.role = $2 AND permission.revoked_at IS NULL`;

async function blendedMentors(ids: number[] | null): Promise<TeamLeadPerson[]> {
  const rows = await query<{ id: number | string; name: string }>(
    `SELECT mentor.id, ${NAME_SQL("mentor")} AS name
     FROM (${BLENDED_MENTOR_IDS_SQL}) mentors
     JOIN "user" mentor ON mentor.id = mentors.id
     WHERE $3::bigint[] IS NULL OR mentor.id = ANY($3::bigint[])
     ORDER BY name, mentor.id`,
    [CURRENT_ACADEMIC_YEAR, BLENDED_MENTOR_ROLE, ids]
  );
  return rows.map((row) => ({ userId: Number(row.id), name: row.name }));
}

// Who can be a team lead or a reportee, A–Z.
export async function listBlendedMentorOptions(access: BlendedLearningAccess): Promise<TeamLeadPerson[]> {
  if (!canBlendedLearning(access, "manage")) return [];
  return blendedMentors(null);
}

type LinkRow = {
  id: number | string;
  supervisor_user_id: number | string;
  supervisor_name: string;
  mentor_user_id: number | string;
  mentor_name: string;
  started_on: string;
};

// The running current-year Supervisions, by team lead then reportee.
export async function listTeamLeadLinks(access: BlendedLearningAccess): Promise<TeamLeadLink[]> {
  if (!canBlendedLearning(access, "manage")) return [];
  const rows = await query<LinkRow>(
    `SELECT supervision.id, supervision.supervisor_user_id, ${NAME_SQL("lead")} AS supervisor_name,
            supervision.mentor_user_id, ${NAME_SQL("reportee")} AS mentor_name,
            ((supervision.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS started_on
     FROM blended_learning_mentor_supervisions supervision
     JOIN "user" lead ON lead.id = supervision.supervisor_user_id
     JOIN "user" reportee ON reportee.id = supervision.mentor_user_id
     WHERE supervision.academic_year = $1 AND supervision.ended_at IS NULL
     ORDER BY supervisor_name, mentor_name, supervision.id`,
    [CURRENT_ACADEMIC_YEAR]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    teamLead: { userId: Number(row.supervisor_user_id), name: row.supervisor_name },
    reportee: { userId: Number(row.mentor_user_id), name: row.mentor_name },
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

// Both must be Blended Learning Mentors.
async function notMentors(pair: Pair): Promise<FieldErrors | null> {
  const found = new Set((await blendedMentors([pair.supervisorUserId, pair.mentorUserId])).map((m) => m.userId));
  const errors: FieldErrors = {};
  if (!found.has(pair.supervisorUserId)) errors.supervisorUserId = "Choose a Blended Learning mentor.";
  if (!found.has(pair.mentorUserId)) errors.mentorUserId = "Choose a Blended Learning mentor.";
  return Object.keys(errors).length > 0 ? errors : null;
}

function audit(access: BlendedLearningAccess): SupervisionAudit {
  return { by: access.actorEmail, source: TEAM_LEAD_SOURCE, reason: null };
}

// Starts a team lead's Supervision of a Mentor; a 409 when it already runs.
export async function createTeamLeadLink(access: BlendedLearningAccess, raw: unknown): Promise<TeamLeadResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  const parsed = parsePair(raw);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const people = await notMentors(parsed.pair);
  if (people) return invalid(people);
  const written = await withTransaction((client) => insertSupervision(client, parsed.pair, audit(access)));
  if (written === 0) return { ok: false, status: 409, error: "This team lead already leads this mentor." };
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
