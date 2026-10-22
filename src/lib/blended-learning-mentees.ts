import { query } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  canBlendedLearning,
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

// Blended Learning read model: the Mentee list and the admin Mentor cards
// (server-only). Reads go
// through query() with $n placeholders. Drafts are read only for the "Draft
// ready to review" chip; they never change Last Contact, Talk to First or
// counts.

export type OpenDraftState = "transcribing" | "ready" | "failed";

export type MenteeRow = {
  studentId: number;
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
  // Date of the latest Attempt, for the "Not reachable, 4 Oct" Why now tag.
  lastAttemptOn?: string | null;
};

export type MenteeList = { talkToFirst: MenteeRow[]; everyoneElse: MenteeRow[] };

type MenteeQueryRow = {
  mentor_user_id: number | string;
  mentor_name: string;
  student_id: number | string;
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
  legacy_last_contact_month: string | null;
  open_draft_state: OpenDraftState | null;
};

function loggedEntry(on: string | null, id: number | string | null) {
  return on === null || id === null ? null : { occurredOn: on, id: Number(id) };
}

function toMentee(row: MenteeQueryRow, today: string): MenteeRow {
  const latestConversation = loggedEntry(row.last_conversation_on, row.last_conversation_id);
  const kind = latestEntryKind(latestConversation, loggedEntry(row.last_attempt_on, row.last_attempt_id));
  const lastContact = lastContactOf(row.last_conversation_on, row.legacy_last_contact_month);
  const policy = talkToFirst({
    latestEntryKind: kind,
    lastConversationOn: row.last_conversation_on,
    legacyMonth: row.legacy_last_contact_month,
    today,
  });
  return {
    studentId: Number(row.student_id),
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

// Active current-year Mappings with what Last Contact and Talk to First need,
// optionally narrowed to one Mentor or one Student.
function menteeRows(mentorUserId: number | null, studentId: number | null) {
  return query<MenteeQueryRow>(
    `SELECT mapping.mentor_user_id,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', mentor.first_name, mentor.last_name)), ''),
                     mentor.email, CONCAT('Mentor ', mapping.mentor_user_id)) AS mentor_name,
            st.id AS student_id, account.first_name, account.last_name, account.gender,
            current_grade.number AS grade, mapping.program_id, program.name AS program_name,
            latest_conversation.occurred_on::text AS last_conversation_on,
            latest_conversation.id AS last_conversation_id,
            latest_attempt.occurred_on::text AS last_attempt_on,
            latest_attempt.id AS last_attempt_id,
            links.legacy_last_contact_month::text AS legacy_last_contact_month,
            open_draft.state AS open_draft_state
     FROM blended_learning_mentor_mentee_mappings mapping
     JOIN student st ON st.id = mapping.student_id
     JOIN "user" account ON account.id = st.user_id
     JOIN program ON program.id = mapping.program_id
     LEFT JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     LEFT JOIN LATERAL (
       SELECT grade.number
       FROM enrollment_record er
       JOIN grade ON grade.id = er.group_id
       WHERE er.user_id = account.id AND er.group_type = 'grade' AND er.is_current IS TRUE
       ORDER BY er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) current_grade ON true
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
       AND ($2::bigint IS NULL OR mapping.mentor_user_id = $2::bigint)
       AND ($3::bigint IS NULL OR mapping.student_id = $3::bigint)`,
    [CURRENT_ACADEMIC_YEAR, mentorUserId, studentId]
  );
}

// Mentees from active current-year Mappings, grouped and sorted. A Mentor
// always gets only their own; an admin gets every Mentor's, or one Mentor's
// when `mentorUserId` is given. `studentId` narrows it to one Mentee's row.
// `today` is the IST calendar date.
export async function listMentees(params: {
  access: BlendedLearningAccess;
  mentorUserId?: number | null;
  studentId?: number;
  today: string;
}): Promise<MenteeList> {
  const { access, today } = params;
  const mentorUserId = access.kind === "mentor" ? access.mentorUserId : params.mentorUserId;
  if (access.kind === "mentor" && mentorUserId == null) return { talkToFirst: [], everyoneElse: [] };

  const rows = await menteeRows(mentorUserId ?? null, params.studentId ?? null);
  const mentees = rows.map((row) => toMentee(row, today)).sort(compareTalkToFirst);
  return {
    talkToFirst: mentees.filter((mentee) => menteeGroup(mentee.reasons) === "Talk to first"),
    everyoneElse: mentees.filter((mentee) => menteeGroup(mentee.reasons) === "Everyone else"),
  };
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

// One card per Mentor with active current-year Mappings, A–Z by name, for
// Blended Learning Admins (view_mentors). Recency uses the same Last Contact
// as the Mentee list, so Attempts and drafts never count.
export async function listMentorCards(access: BlendedLearningAccess, today: string): Promise<MentorCard[]> {
  if (!canBlendedLearning(access, "view_mentors")) return [];

  const cards = new Map<number, MentorCard>();
  for (const row of await menteeRows(null, null)) {
    const mentorUserId = Number(row.mentor_user_id);
    const card = cards.get(mentorUserId) ?? {
      mentorUserId,
      name: row.mentor_name,
      assigned: 0,
      grade12: 0,
      grade13: 0,
      talkedLast7: 0,
      notSpoken30Plus: 0,
    };
    const { daysSince, grade } = toMentee(row, today);
    card.assigned += 1;
    if (grade === 12) card.grade12 += 1;
    if (grade === 13) card.grade13 += 1;
    if (talkedToInLastWeek(daysSince)) card.talkedLast7 += 1;
    if (thirtyDaysOrMore(daysSince)) card.notSpoken30Plus += 1;
    cards.set(mentorUserId, card);
  }
  return [...cards.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
