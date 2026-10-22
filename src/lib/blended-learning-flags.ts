import { query } from "./db";
import { canBlendedLearning, type BlendedLearningAccess } from "./blended-learning-access";
import { contactNumbers, present, type FlagRecipient } from "./blended-learning-mentee-detail";

// Blended Learning Admin Flags feed (server-only): every Mentor Flag, newest
// first by (inserted_at, id), and each viewer's "last seen" time behind the
// "N new" badge. Flags have no resolution; the feed is read-only.

export const FLAGS_PAGE_SIZE = 50;
export const FLAG_RECIPIENTS: readonly FlagRecipient[] = ["emotional_wellbeing", "physics", "chemistry", "maths"];

export type FlagCard = {
  id: number;
  recipient: FlagRecipient;
  comment: string | null;
  // Raised after the viewer's previous visit.
  isNew: boolean;
  conversationId: number;
  occurredOn: string;
  hasNotes: boolean;
  mentorUserId: number;
  mentorName: string;
  studentId: number;
  name: string;
  grade: number | null;
  programName: string | null;
  gender: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  profileDocUrl: string | null;
  screenerUrl: string | null;
};

export type FlagsPage = {
  flags: FlagCard[];
  // The last flag's id when an older page exists.
  nextCursor: number | null;
  // Every flag raised since the viewer's previous visit, whatever the filters.
  newCount: number;
};

export type FlagFilters = {
  mentorUserId?: number | null;
  recipient?: FlagRecipient | null;
  // The id of the last flag on the previous page.
  cursor?: number | null;
};

type FlagRow = {
  id: number | string;
  recipient: FlagRecipient;
  comment: string | null;
  is_new: boolean;
  conversation_id: number | string;
  occurred_on: string;
  has_notes: boolean;
  mentor_user_id: number | string;
  mentor_name: string;
  student_id: number | string;
  first_name: string | null;
  last_name: string | null;
  grade: number | string | null;
  program_name: string | null;
  gender: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  profile_doc_url: string | null;
  screener_url: string | null;
};

const MENTOR_NAME_SQL = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', mentor.first_name, mentor.last_name)), ''),
                     mentor.email, CONCAT('Mentor ', c.mentor_user_id))`;

// The viewer's previous visit, or NULL before their first.
const LAST_SEEN_SQL = `(SELECT views.last_seen_at FROM blended_learning_flag_views views
                        WHERE lower(views.viewer_email) = lower($1))`;

// How many flags were raised since the viewer's previous visit.
export async function countNewFlags(access: BlendedLearningAccess): Promise<number> {
  if (!canBlendedLearning(access, "view_flags")) return 0;
  const rows = await query<{ count: number | string }>(
    `SELECT count(*) AS count
     FROM blended_learning_mentor_flags flag
     WHERE ${LAST_SEEN_SQL} IS NULL OR flag.inserted_at > ${LAST_SEEN_SQL}`,
    [access.actorEmail]
  );
  return Number(rows[0]?.count ?? 0);
}

// One page of the feed, narrowed by the Conversation's Mentor and the Flag
// Recipient. Null when the actor may not see flags.
export async function listFlags(access: BlendedLearningAccess, filters: FlagFilters = {}): Promise<FlagsPage | null> {
  if (!canBlendedLearning(access, "view_flags")) return null;
  const [rows, newCount] = await Promise.all([
    query<FlagRow>(
      `SELECT flag.id, flag.recipient, flag.comment,
              (${LAST_SEEN_SQL} IS NULL OR flag.inserted_at > ${LAST_SEEN_SQL}) AS is_new,
              c.id AS conversation_id, c.occurred_on::text AS occurred_on,
              (c.notes_html IS NOT NULL) AS has_notes,
              c.mentor_user_id, ${MENTOR_NAME_SQL} AS mentor_name,
              st.id AS student_id, account.first_name, account.last_name, account.gender,
              account.phone, account.whatsapp_phone,
              current_grade.number AS grade, program.name AS program_name,
              links.profile_doc_url, links.screener_url
       FROM blended_learning_mentor_flags flag
       JOIN blended_learning_conversations c ON c.id = flag.conversation_id
       JOIN student st ON st.id = flag.student_id
       JOIN "user" account ON account.id = st.user_id
       LEFT JOIN "user" mentor ON mentor.id = c.mentor_user_id
       LEFT JOIN program ON program.id = c.program_id
       LEFT JOIN LATERAL (
         SELECT grade.number
         FROM enrollment_record er
         JOIN grade ON grade.id = er.group_id
         WHERE er.user_id = account.id AND er.group_type = 'grade' AND er.is_current IS TRUE
         ORDER BY er.updated_at DESC NULLS LAST, er.id DESC
         LIMIT 1
       ) current_grade ON true
       LEFT JOIN blended_learning_student_links links ON links.student_id = st.id
       WHERE ($2::bigint IS NULL OR c.mentor_user_id = $2::bigint)
         AND ($3::varchar IS NULL OR flag.recipient = $3::varchar)
         AND ($4::bigint IS NULL OR (flag.inserted_at, flag.id) <
              (SELECT cursor_flag.inserted_at, cursor_flag.id FROM blended_learning_mentor_flags cursor_flag
               WHERE cursor_flag.id = $4::bigint))
       ORDER BY flag.inserted_at DESC, flag.id DESC
       LIMIT $5`,
      [
        access.actorEmail,
        filters.mentorUserId ?? null,
        filters.recipient ?? null,
        filters.cursor ?? null,
        FLAGS_PAGE_SIZE + 1,
      ]
    ),
    countNewFlags(access),
  ]);

  const page = rows.slice(0, FLAGS_PAGE_SIZE);
  return {
    flags: page.map((row) => ({
      id: Number(row.id),
      recipient: row.recipient,
      comment: row.comment,
      isNew: row.is_new,
      conversationId: Number(row.conversation_id),
      occurredOn: row.occurred_on,
      hasNotes: row.has_notes,
      mentorUserId: Number(row.mentor_user_id),
      mentorName: row.mentor_name,
      studentId: Number(row.student_id),
      name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      grade: row.grade === null ? null : Number(row.grade),
      programName: row.program_name,
      gender: row.gender,
      ...contactNumbers(row.phone, row.whatsapp_phone),
      profileDocUrl: present(row.profile_doc_url),
      screenerUrl: present(row.screener_url),
    })),
    nextCursor: rows.length > FLAGS_PAGE_SIZE ? Number(page[page.length - 1].id) : null,
    newCount,
  };
}

// The Mentors who have Conversations with flags, A–Z, for the Mentor filter.
export async function listFlagMentors(
  access: BlendedLearningAccess
): Promise<{ mentorUserId: number; name: string }[]> {
  if (!canBlendedLearning(access, "view_flags")) return [];
  const rows = await query<{ mentor_user_id: number | string; mentor_name: string }>(
    `SELECT DISTINCT c.mentor_user_id, ${MENTOR_NAME_SQL} AS mentor_name
     FROM blended_learning_mentor_flags flag
     JOIN blended_learning_conversations c ON c.id = flag.conversation_id
     LEFT JOIN "user" mentor ON mentor.id = c.mentor_user_id
     ORDER BY mentor_name, c.mentor_user_id`
  );
  return rows.map((row) => ({ mentorUserId: Number(row.mentor_user_id), name: row.mentor_name }));
}

// Record the viewer's visit. One row per lower-cased email; the only write a
// read-only Blended Learning Admin can make.
export async function recordFlagsSeen(access: BlendedLearningAccess): Promise<{ lastSeenAt: string } | null> {
  if (!canBlendedLearning(access, "view_flags")) return null;
  const rows = await query<{ last_seen_at: string }>(
    `INSERT INTO blended_learning_flag_views (viewer_email, viewer_user_id, last_seen_at, inserted_at, updated_at)
     VALUES ($1, $2, now(), now(), now())
     ON CONFLICT ((lower(viewer_email))) DO UPDATE
       SET last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at
     RETURNING last_seen_at::text AS last_seen_at`,
    [access.actorEmail, access.actorUserId]
  );
  return { lastSeenAt: rows[0].last_seen_at };
}
