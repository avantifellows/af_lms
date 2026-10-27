import { query } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  canBlendedLearning,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import { contactNumbers, present, type FlagRecipient } from "./blended-learning-mentee-detail";

// The Flags feed (server-only): for a Blended Learning Admin every Mentor
// Flag, for a Mentor only the flags on their own Students (an active
// current-year Mapping to them), newest first by (inserted_at, id), and each
// viewer's "last seen" time behind the "N new" badge. A Mentor's scope is in
// every query here, so another Mentor's flags are never read. Flags have no
// resolution; the feed is read-only.
//
// A visit to the Flags tab starts when the admin opens the tab: the page reads
// their previous "last seen" as the visit's cutoff and records the visit. The
// filter and page links carry that cutoff (`since`), so the same flags stay
// New for the whole visit even though "last seen" has moved on.

const FLAGS_PAGE_SIZE = 50;
export const FLAG_RECIPIENTS: readonly FlagRecipient[] = ["emotional_wellbeing", "physics", "chemistry", "maths"];

export type FlagCard = {
  id: number;
  recipient: FlagRecipient;
  comment: string | null;
  // Raised after the viewer's previous visit.
  isNew: boolean;
  // The Student still has an active current-year Mapping, so their page and
  // the Conversation's notes can be opened. A flag outlives its Mapping.
  inScope: boolean;
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

// The visit's cutoff: the viewer's "last seen" before this visit, or null
// before their first visit. Flags inserted after it are New. Both columns are
// timestamp(0) without time zone, so the cutoff is that same wall-clock value
// ("YYYY-MM-DDTHH:MM:SS"), never shifted to another zone.
export type FlagsCutoff = { lastSeenAt: string | null };

// The cutoff as a URL value, and back. "never" is the first visit.
const NEVER_SEEN = "never";
const CUTOFF_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

export function flagsCutoffParam(cutoff: FlagsCutoff): string {
  return cutoff.lastSeenAt ?? NEVER_SEEN;
}

// Null for a missing or malformed value: the page then starts a new visit.
export function parseFlagsCutoff(value: string | undefined): FlagsCutoff | null {
  if (value === NEVER_SEEN) return { lastSeenAt: null };
  const match = value ? CUTOFF_TIMESTAMP.exec(value) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Rejects 2026-02-30, 25:00 and the like, which Postgres would refuse.
  if (date.toISOString().slice(0, 19) !== value) return null;
  return { lastSeenAt: value };
}

type FlagRow = {
  id: number | string;
  recipient: FlagRecipient;
  comment: string | null;
  is_new: boolean;
  in_scope: boolean;
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

// The viewer's scope as query parameters: whether to narrow to one Mentor's
// own Students, and that Mentor. A Mentor with no `user` id matches nothing.
function flagScope(access: BlendedLearningAccess): [boolean, number | null] {
  return access.kind === "mentor" ? [true, access.mentorUserId ?? null] : [false, null];
}

// The flag is in the viewer's scope (flagScope's parameters at `scoped` and
// `mentor`; the academic year at `year`).
function inViewerScopeSql(scoped: string, mentor: string, year: string): string {
  return `(NOT ${scoped}::boolean OR EXISTS (
            SELECT 1 FROM blended_learning_mentor_mentee_mappings own
            WHERE own.student_id = flag.student_id AND own.mentor_user_id = ${mentor}::bigint
              AND ${activeBlendedMappingSql("own", year)}))`;
}

// The viewer's previous visit, or NULL before their first.
const LAST_SEEN_SQL = `(SELECT views.last_seen_at FROM blended_learning_flag_views views
                        WHERE lower(views.viewer_email) = lower($1))`;

// The viewer's "last seen" as it stands, as the cutoff for a visit starting now.
export async function readFlagsCutoff(access: BlendedLearningAccess): Promise<FlagsCutoff> {
  if (!canBlendedLearning(access, "view_flags")) return { lastSeenAt: null };
  const rows = await query<{ last_seen_at: string | null }>(
    `SELECT to_char(${LAST_SEEN_SQL}, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_seen_at`,
    [access.actorEmail]
  );
  return { lastSeenAt: rows[0]?.last_seen_at ?? null };
}

// How many flags were raised after the cutoff: the given visit's, else the
// viewer's "last seen" as it stands.
export async function countNewFlags(access: BlendedLearningAccess, cutoff?: FlagsCutoff): Promise<number> {
  if (!canBlendedLearning(access, "view_flags")) return 0;
  const scope = [...flagScope(access), CURRENT_ACADEMIC_YEAR];
  const rows = cutoff
    ? await query<{ count: number | string }>(
        `SELECT count(*) AS count
         FROM blended_learning_mentor_flags flag
         WHERE ($1::timestamp IS NULL OR flag.inserted_at > $1::timestamp)
           AND ${inViewerScopeSql("$2", "$3", "$4")}`,
        [cutoff.lastSeenAt, ...scope]
      )
    : await query<{ count: number | string }>(
        `SELECT count(*) AS count
         FROM blended_learning_mentor_flags flag
         WHERE (${LAST_SEEN_SQL} IS NULL OR flag.inserted_at > ${LAST_SEEN_SQL})
           AND ${inViewerScopeSql("$2", "$3", "$4")}`,
        [access.actorEmail, ...scope]
      );
  return Number(rows[0]?.count ?? 0);
}

// One page of the viewer's feed, narrowed by the Conversation's Mentor (for
// admins; a Mentor's feed is theirs already) and the Flag Recipient, with New
// marked against the visit's cutoff. Null when the actor may not see flags.
export async function listFlags(
  access: BlendedLearningAccess,
  filters: FlagFilters,
  cutoff: FlagsCutoff
): Promise<FlagsPage | null> {
  if (!canBlendedLearning(access, "view_flags")) return null;
  const [rows, newCount] = await Promise.all([
    query<FlagRow>(
      `SELECT flag.id, flag.recipient, flag.comment,
              ($1::timestamp IS NULL OR flag.inserted_at > $1::timestamp) AS is_new,
              EXISTS (
                SELECT 1 FROM blended_learning_mentor_mentee_mappings mapping
                WHERE mapping.student_id = st.id AND ${activeBlendedMappingSql("mapping", "$6")}
              ) AS in_scope,
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
       WHERE ${inViewerScopeSql("$7", "$8", "$6")}
         AND ($2::bigint IS NULL OR c.mentor_user_id = $2::bigint)
         AND ($3::varchar IS NULL OR flag.recipient = $3::varchar)
         AND ($4::bigint IS NULL OR (flag.inserted_at, flag.id) <
              (SELECT cursor_flag.inserted_at, cursor_flag.id FROM blended_learning_mentor_flags cursor_flag
               WHERE cursor_flag.id = $4::bigint))
       ORDER BY flag.inserted_at DESC, flag.id DESC
       LIMIT $5`,
      [
        cutoff.lastSeenAt,
        access.kind === "admin" ? (filters.mentorUserId ?? null) : null,
        filters.recipient ?? null,
        filters.cursor ?? null,
        FLAGS_PAGE_SIZE + 1,
        CURRENT_ACADEMIC_YEAR,
        ...flagScope(access),
      ]
    ),
    countNewFlags(access, cutoff),
  ]);

  const page = rows.slice(0, FLAGS_PAGE_SIZE);
  return {
    flags: page.map((row) => ({
      id: Number(row.id),
      recipient: row.recipient,
      comment: row.comment,
      isNew: row.is_new,
      inScope: row.in_scope,
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

// The Mentors who have Conversations with flags, A–Z, for the admins' Mentor
// filter. A Mentor has no such filter.
export async function listFlagMentors(
  access: BlendedLearningAccess
): Promise<{ mentorUserId: number; name: string }[]> {
  if (access.kind !== "admin" || !canBlendedLearning(access, "view_flags")) return [];
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
    `INSERT INTO blended_learning_flag_views (viewer_email, last_seen_at, inserted_at, updated_at)
     VALUES ($1, now(), now(), now())
     ON CONFLICT ((lower(viewer_email))) DO UPDATE
       SET last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at
     RETURNING last_seen_at::text AS last_seen_at`,
    [access.actorEmail]
  );
  return { lastSeenAt: rows[0].last_seen_at };
}
