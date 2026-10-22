import { query } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  canAccessBlendedStudent,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import type { OpenDraftState } from "./blended-learning-mentees";
import { presignDocumentPage } from "./s3";

const PHOTO_URL_TTL_SECONDS = 300; // 5 minutes

// Blended Learning read model: one Mentee's detail page and a Conversation's
// on-demand notes and photos (server-only). Every read checks
// canAccessBlendedStudent first; out of scope reads as null (a 404).

export type ActionItem = { id: number; text: string; status: "open" | "done" };
export type FlagRecipient = "emotional_wellbeing" | "physics" | "chemistry" | "maths";
export type MentorFlag = { recipient: FlagRecipient; comment: string | null };

export type HistoryEntry =
  | { kind: "attempt"; id: number; occurredOn: string; note: string | null }
  | {
      kind: "conversation";
      id: number;
      occurredOn: string;
      mode: "call" | "in_person";
      spokeWith: "student" | "parent_or_sibling" | "both";
      durationMinutes: number;
      summary: string;
      hasNotes: boolean;
      photoCount: number;
      actionItems: ActionItem[];
      flags: MentorFlag[];
    };

export type MenteeDetail = {
  studentId: number;
  name: string;
  gender: string | null;
  grade: number | null;
  programName: string | null;
  phone: string | null;
  // Only when it differs from `phone`. Parent phones are never read.
  whatsappPhone: string | null;
  profileDocUrl: string | null;
  screenerUrl: string | null;
  openDraft: { id: number; state: OpenDraftState } | null;
  // Newest first by (occurred_on, id), Conversations and Attempts interleaved.
  history: HistoryEntry[];
};

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  grade: number | string | null;
  program_name: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  profile_doc_url: string | null;
  screener_url: string | null;
  open_draft_id: number | string | null;
  open_draft_state: OpenDraftState | null;
};

type EntryRow = {
  id: number | string;
  kind: "conversation" | "attempt";
  occurred_on: string;
  mode: "call" | "in_person" | null;
  spoke_with: "student" | "parent_or_sibling" | "both" | null;
  duration_minutes: number | string | null;
  summary: string | null;
  attempt_note: string | null;
  has_notes: boolean;
  photo_count: number | string;
};

// Two numbers are the same contact when their last ten digits match, so a
// "+91 " prefix or spacing does not show a duplicate WhatsApp line.
function sameNumber(a: string, b: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, "").slice(-10);
  return digits(a) === digits(b);
}

function present(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null;
}

function groupBy<T extends { conversation_id: number | string }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const key = Number(row.conversation_id);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

// One Mentee's profile, contact, links, open draft and history. Null when
// the Student is out of the actor's scope or has no active Mapping.
export async function getMenteeDetail(
  access: BlendedLearningAccess,
  studentId: number
): Promise<MenteeDetail | null> {
  if (!(await canAccessBlendedStudent(access, studentId))) return null;

  const profiles = await query<ProfileRow>(
    `SELECT account.first_name, account.last_name, account.gender, account.phone, account.whatsapp_phone,
            current_grade.number AS grade, program.name AS program_name,
            links.profile_doc_url, links.screener_url,
            open_draft.id AS open_draft_id, open_draft.state AS open_draft_state
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
     LEFT JOIN blended_learning_student_links links ON links.student_id = st.id
     LEFT JOIN blended_learning_conversation_drafts open_draft
       ON open_draft.student_id = st.id AND open_draft.state IN ('transcribing', 'ready', 'failed')
     WHERE mapping.student_id = $1 AND ${activeBlendedMappingSql("mapping", "$2")}
     LIMIT 1`,
    [studentId, CURRENT_ACADEMIC_YEAR]
  );
  const profile = profiles[0];
  if (!profile) return null;

  const [entries, actionItems, flags] = await Promise.all([
    query<EntryRow>(
      `SELECT c.id, c.kind, c.occurred_on::text AS occurred_on, c.mode, c.spoke_with, c.duration_minutes,
              c.summary, c.attempt_note, (c.notes_html IS NOT NULL) AS has_notes,
              (SELECT count(*) FROM blended_learning_conversation_photos photo
               WHERE photo.conversation_id = c.id) AS photo_count
       FROM blended_learning_conversations c
       WHERE c.student_id = $1
       ORDER BY c.occurred_on DESC, c.id DESC`,
      [studentId]
    ),
    query<{ conversation_id: number | string; id: number | string; text: string; status: "open" | "done" }>(
      `SELECT conversation_id, id, text, status
       FROM blended_learning_action_items
       WHERE student_id = $1
       ORDER BY conversation_id, position`,
      [studentId]
    ),
    query<{ conversation_id: number | string; recipient: FlagRecipient; comment: string | null }>(
      `SELECT conversation_id, recipient, comment
       FROM blended_learning_mentor_flags
       WHERE student_id = $1
       ORDER BY conversation_id, CASE recipient
         WHEN 'emotional_wellbeing' THEN 1 WHEN 'physics' THEN 2 WHEN 'chemistry' THEN 3 ELSE 4 END`,
      [studentId]
    ),
  ]);
  const itemsByConversation = groupBy(actionItems);
  const flagsByConversation = groupBy(flags);

  const phone = present(profile.phone);
  const whatsapp = present(profile.whatsapp_phone);
  return {
    studentId,
    name: [profile.first_name, profile.last_name].filter(Boolean).join(" "),
    gender: profile.gender,
    grade: profile.grade === null ? null : Number(profile.grade),
    programName: profile.program_name,
    phone,
    whatsappPhone: whatsapp && !(phone && sameNumber(phone, whatsapp)) ? whatsapp : null,
    profileDocUrl: present(profile.profile_doc_url),
    screenerUrl: present(profile.screener_url),
    openDraft:
      profile.open_draft_id === null || profile.open_draft_state === null
        ? null
        : { id: Number(profile.open_draft_id), state: profile.open_draft_state },
    history: entries.map((entry): HistoryEntry => {
      const id = Number(entry.id);
      if (entry.kind === "attempt") {
        return { kind: "attempt", id, occurredOn: entry.occurred_on, note: entry.attempt_note };
      }
      return {
        kind: "conversation",
        id,
        occurredOn: entry.occurred_on,
        mode: entry.mode ?? "call",
        spokeWith: entry.spoke_with ?? "student",
        durationMinutes: Number(entry.duration_minutes),
        summary: entry.summary ?? "",
        hasNotes: entry.has_notes,
        photoCount: Number(entry.photo_count),
        actionItems: (itemsByConversation.get(id) ?? []).map((item) => ({
          id: Number(item.id),
          text: item.text,
          status: item.status,
        })),
        flags: (flagsByConversation.get(id) ?? []).map((flag) => ({
          recipient: flag.recipient,
          comment: flag.comment,
        })),
      };
    }),
  };
}

// A saved Conversation (not an Attempt) and whether the actor may read it.
async function conversationInScope(access: BlendedLearningAccess, conversationId: number) {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return null;
  const rows = await query<{ student_id: number | string; kind: string; notes_html: string | null }>(
    `SELECT student_id, kind, notes_html FROM blended_learning_conversations WHERE id = $1`,
    [conversationId]
  );
  const conversation = rows[0];
  if (!conversation || conversation.kind !== "conversation") return null;
  if (!(await canAccessBlendedStudent(access, Number(conversation.student_id)))) return null;
  return conversation;
}

// The stored, already-sanitised notes HTML (null when saved without notes).
export async function getConversationNotes(
  access: BlendedLearningAccess,
  conversationId: number
): Promise<{ notesHtml: string | null } | null> {
  const conversation = await conversationInScope(access, conversationId);
  return conversation ? { notesHtml: conversation.notes_html } : null;
}

// Short-lived presigned GETs for a Conversation's photos, in position order.
export async function getConversationPhotos(
  access: BlendedLearningAccess,
  conversationId: number
): Promise<{ photos: { id: number; url: string }[] } | null> {
  if (!(await conversationInScope(access, conversationId))) return null;
  const rows = await query<{ id: number | string; s3_key: string; content_type: string }>(
    `SELECT id, s3_key, content_type
     FROM blended_learning_conversation_photos
     WHERE conversation_id = $1
     ORDER BY position`,
    [conversationId]
  );
  const photos = await Promise.all(
    rows.map(async (row) => ({
      id: Number(row.id),
      url: await presignDocumentPage({
        s3Key: row.s3_key,
        ttlSeconds: PHOTO_URL_TTL_SECONDS,
        responseContentType: row.content_type,
      }),
    }))
  );
  return { photos };
}
