import { query } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { activeBlendedMappingSql, type BlendedLearningAccess } from "./blended-learning-access";
import {
  compareTalkToFirst,
  lastContactOf,
  latestEntryKind,
  talkToFirst,
  type BlendedEntryKind,
  type TalkToFirstReason,
} from "./blended-learning-talk-to-first";

// Blended Learning read model: the Mentee list (server-only). Reads go
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
};

export type MenteeList = { talkToFirst: MenteeRow[]; everyoneElse: MenteeRow[] };

type MenteeQueryRow = {
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
  };
}

// Mentees from active current-year Mappings, grouped and sorted. A Mentor
// always gets only their own; an admin gets every Mentor's, or one Mentor's
// when `mentorUserId` is given. `today` is the IST calendar date.
export async function listMentees(params: {
  access: BlendedLearningAccess;
  mentorUserId?: number | null;
  today: string;
}): Promise<MenteeList> {
  const { access, today } = params;
  const mentorUserId = access.kind === "mentor" ? access.mentorUserId : params.mentorUserId;
  if (access.kind === "mentor" && mentorUserId == null) return { talkToFirst: [], everyoneElse: [] };

  const rows = await query<MenteeQueryRow>(
    `SELECT st.id AS student_id, account.first_name, account.last_name, account.gender,
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
       AND ($2::bigint IS NULL OR mapping.mentor_user_id = $2::bigint)`,
    [CURRENT_ACADEMIC_YEAR, mentorUserId ?? null]
  );

  const mentees = rows.map((row) => toMentee(row, today)).sort(compareTalkToFirst);
  return {
    talkToFirst: mentees.filter((mentee) => mentee.reasons.length > 0),
    everyoneElse: mentees.filter((mentee) => mentee.reasons.length === 0),
  };
}
