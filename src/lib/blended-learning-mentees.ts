import { query } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  canBlendedLearning,
  isTeamLead,
  supervisedMentor,
  viewableMentorUserIds,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import {
  compareTalkToFirst,
  lastContactOf,
  latestEntryKind,
  menteeGroup,
  talkedToInLastWeek,
  talkToFirst,
  thirtyDaysOrMore,
  type BlendedEntryKind,
  type TalkToFirstReason,
} from "./blended-learning-talk-to-first";

// Blended Learning read model: the Mentee list and the Mentor cards
// (server-only). Reads go
// through query() with $n placeholders. Drafts are read only for the "Draft
// ready to review" chip; they never change Last Contact, Talk to First or
// counts.

export type OpenDraftState = "transcribing" | "ready" | "failed";

export type MenteeRow = {
  // `student.id`, for links and every Blended Learning id.
  studentId: number;
  // `student.student_id`, the program's Student ID as text (leading zeros
  // kept), and `student.category`; either may be NULL.
  programStudentId: string | null;
  category: string | null;
  name: string;
  gender: string | null;
  grade: number | null;
  programId: number;
  programName: string | null;
  lastContact: string | null;
  lastContactSource: "conversation" | "legacy" | null;
  latestEntryKind: BlendedEntryKind | null;
  openDraftState: OpenDraftState | null;
  reasons: TalkToFirstReason[];
  daysSince: number | null;
  // Date of the latest Attempt, for the "Unreachable · 4 Oct" Why now tag.
  lastAttemptOn?: string | null;
};

export type MenteeList = { talkToFirst: MenteeRow[]; everyoneElse: MenteeRow[] };

type MenteeQueryRow = {
  mentor_user_id: number | string;
  mentor_name: string;
  student_id: number | string;
  program_student_id: string | null;
  category: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  grade: number | string | null;
  program_id: number | string;
  program_name: string | null;
  last_conversation_on: string | null;
  last_conversation_id: number | string | null;
  last_attempt_on: string | null;
  last_attempt_id: number | string | null;
  legacy_last_contact_on: string | null;
  open_draft_state: OpenDraftState | null;
};

function loggedEntry(on: string | null, id: number | string | null) {
  return on === null || id === null ? null : { occurredOn: on, id: Number(id) };
}

function toMentee(row: MenteeQueryRow, today: string): MenteeRow {
  const latestConversation = loggedEntry(row.last_conversation_on, row.last_conversation_id);
  const kind = latestEntryKind(latestConversation, loggedEntry(row.last_attempt_on, row.last_attempt_id));
  const lastContact = lastContactOf(row.last_conversation_on, row.legacy_last_contact_on);
  const policy = talkToFirst({
    latestEntryKind: kind,
    lastConversationOn: row.last_conversation_on,
    legacyLastContactOn: row.legacy_last_contact_on,
    today,
  });
  return {
    studentId: Number(row.student_id),
    programStudentId: row.program_student_id,
    category: row.category,
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    gender: row.gender,
    grade: row.grade === null ? null : Number(row.grade),
    programId: Number(row.program_id),
    programName: row.program_name,
    lastContact: lastContact?.on ?? null,
    lastContactSource: lastContact?.source ?? null,
    latestEntryKind: kind,
    openDraftState: row.open_draft_state,
    reasons: policy.reasons,
    daysSince: policy.daysSince,
    lastAttemptOn: row.last_attempt_on ?? null,
  };
}

// The Student's grade, as the list shows it: the number of their current
// grade enrollment, joined as `current_grade` (NULL when there is none).
// `userId` is the SQL for the Student's `user` id.
export function currentGradeLateralSql(userId: string): string {
  return `LEFT JOIN LATERAL (
       SELECT grade.number
       FROM enrollment_record er
       JOIN grade ON grade.id = er.group_id
       WHERE er.user_id = ${userId} AND er.group_type = 'grade' AND er.is_current IS TRUE
       ORDER BY er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) current_grade ON true`;
}

// A Mentor's display name: their full name, else email, else "Mentor <id>"
// (`mentor` is the `user` alias).
const MENTOR_NAME_SQL = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', mentor.first_name, mentor.last_name)), ''),
                     mentor.email, CONCAT('Mentor ', mentor.id))`;

// Active current-year Mappings with what Last Contact and Talk to First need,
// optionally narrowed to some Mentors or one Student.
function menteeRows(mentorUserIds: number[] | null, studentId: number | null) {
  return query<MenteeQueryRow>(
    `SELECT mapping.mentor_user_id,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', mentor.first_name, mentor.last_name)), ''),
                     mentor.email, CONCAT('Mentor ', mapping.mentor_user_id)) AS mentor_name,
            st.id AS student_id, st.student_id AS program_student_id, st.category,
            account.first_name, account.last_name, account.gender,
            current_grade.number AS grade, mapping.program_id, program.name AS program_name,
            latest_conversation.occurred_on::text AS last_conversation_on,
            latest_conversation.id AS last_conversation_id,
            latest_attempt.occurred_on::text AS last_attempt_on,
            latest_attempt.id AS last_attempt_id,
            links.legacy_last_contact_on::text AS legacy_last_contact_on,
            open_draft.state AS open_draft_state
     FROM blended_learning_mentor_mentee_mappings mapping
     JOIN student st ON st.id = mapping.student_id
     JOIN "user" account ON account.id = st.user_id
     JOIN program ON program.id = mapping.program_id
     LEFT JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     ${currentGradeLateralSql("account.id")}
     LEFT JOIN LATERAL (
       SELECT c.occurred_on, c.id
       FROM blended_learning_conversations c
       WHERE c.student_id = st.id AND c.kind = 'conversation'
       ORDER BY c.occurred_on DESC, c.id DESC
       LIMIT 1
     ) latest_conversation ON true
     LEFT JOIN LATERAL (
       SELECT c.occurred_on, c.id
       FROM blended_learning_conversations c
       WHERE c.student_id = st.id AND c.kind = 'attempt'
       ORDER BY c.occurred_on DESC, c.id DESC
       LIMIT 1
     ) latest_attempt ON true
     LEFT JOIN blended_learning_student_links links ON links.student_id = st.id
     LEFT JOIN blended_learning_conversation_drafts open_draft
       ON open_draft.student_id = st.id AND open_draft.state IN ('transcribing', 'ready', 'failed')
     WHERE ${activeBlendedMappingSql("mapping", "$1")}
       AND ($2::bigint[] IS NULL OR mapping.mentor_user_id = ANY($2::bigint[]))
       AND ($3::bigint IS NULL OR mapping.student_id = $3::bigint)`,
    [CURRENT_ACADEMIC_YEAR, mentorUserIds, studentId]
  );
}

// Mentees from active current-year Mappings, grouped and sorted. A Mentor
// gets their own, or a Mentor's they supervise when `mentorUserId` is one
// (any other id gets their own); an admin gets every Mentor's, or one
// Mentor's when `mentorUserId` is given. `studentId` narrows it to one
// Mentee's row. `today` is the IST calendar date.
export async function listMentees(params: {
  access: BlendedLearningAccess;
  mentorUserId?: number | null;
  studentId?: number;
  today: string;
}): Promise<MenteeList> {
  const { access, today } = params;
  const mentorUserId =
    access.kind === "mentor"
      ? (supervisedMentor(access, params.mentorUserId ?? null) ?? access.mentorUserId)
      : params.mentorUserId;
  if (access.kind === "mentor" && mentorUserId == null) return { talkToFirst: [], everyoneElse: [] };

  const rows = await menteeRows(mentorUserId == null ? null : [mentorUserId], params.studentId ?? null);
  const mentees = rows.map((row) => toMentee(row, today)).sort(compareTalkToFirst);
  return {
    talkToFirst: mentees.filter((mentee) => menteeGroup(mentee.reasons) === "Talk to first"),
    everyoneElse: mentees.filter((mentee) => menteeGroup(mentee.reasons) === "Everyone else"),
  };
}

export type SupervisedMentor = { mentorUserId: number; name: string };

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

// These Mentors' display names, A–Z.
async function mentorNames(ids: number[]): Promise<SupervisedMentor[]> {
  if (ids.length === 0) return [];
  const rows = await query<{ id: number | string; name: string }>(
    `SELECT mentor.id, ${MENTOR_NAME_SQL} AS name
     FROM "user" mentor
     WHERE mentor.id = ANY($1::bigint[])`,
    [ids]
  );
  return rows.map((row) => ({ mentorUserId: Number(row.id), name: row.name })).sort(byName);
}

// The Mentors a supervisor supervises, A–Z by name, for the Flags tab's
// Mentor filter. Empty for anyone who supervises no one (admins included:
// they have the Mentor cards).
export async function listSupervisedMentors(access: BlendedLearningAccess): Promise<SupervisedMentor[]> {
  return mentorNames(access.kind === "mentor" ? (access.supervisedMentorUserIds ?? []) : []);
}

export type MentorCard = {
  mentorUserId: number;
  name: string;
  assigned: number;
  grade12: number;
  grade13: number;
  // Last Contact under 7 IST days ago.
  talkedLast7: number;
  // Last Contact 30+ IST days ago, or none at all.
  notSpoken30Plus: number;
};

function emptyCard(mentorUserId: number, name: string): MentorCard {
  return { mentorUserId, name, assigned: 0, grade12: 0, grade13: 0, talkedLast7: 0, notSpoken30Plus: 0 };
}

// Adds one Mentee's Mapping row to its Mentor's card.
function countMentee(cards: Map<number, MentorCard>, row: MenteeQueryRow, today: string) {
  const mentorUserId = Number(row.mentor_user_id);
  const card = cards.get(mentorUserId) ?? emptyCard(mentorUserId, row.mentor_name);
  const { daysSince, grade } = toMentee(row, today);
  card.assigned += 1;
  if (grade === 12) card.grade12 += 1;
  if (grade === 13) card.grade13 += 1;
  if (talkedToInLastWeek(daysSince)) card.talkedLast7 += 1;
  if (thirtyDaysOrMore(daysSince)) card.notSpoken30Plus += 1;
  cards.set(mentorUserId, card);
}

// A team lead's cards: their own first, then their reportees' A–Z, each
// shown even with no Mentees mapped.
async function teamLeadCards(access: BlendedLearningAccess, today: string): Promise<MentorCard[]> {
  const ids = viewableMentorUserIds(access) ?? [];
  const [names, rows] = await Promise.all([mentorNames(ids), menteeRows(ids, null)]);
  const cards = new Map(names.map(({ mentorUserId, name }) => [mentorUserId, emptyCard(mentorUserId, name)]));
  for (const row of rows) countMentee(cards, row, today);
  const own = (card: MentorCard) => (card.mentorUserId === access.mentorUserId ? 0 : 1);
  return [...cards.values()].sort((a, b) => own(a) - own(b) || byName(a, b));
}

// Mentor cards, for the same grade counts and Last Contact recency as the
// Mentee list (Attempts and drafts never count). A Blended Learning Admin
// (view_mentors) gets one per Mentor with active current-year Mappings, A–Z
// by name; a team lead (isTeamLead) gets their own and their reportees'; any
// other Mentor none.
export async function listMentorCards(access: BlendedLearningAccess, today: string): Promise<MentorCard[]> {
  if (isTeamLead(access)) return teamLeadCards(access, today);
  if (!canBlendedLearning(access, "view_mentors")) return [];

  const cards = new Map<number, MentorCard>();
  for (const row of await menteeRows(null, null)) countMentee(cards, row, today);
  return [...cards.values()].sort(byName);
}
