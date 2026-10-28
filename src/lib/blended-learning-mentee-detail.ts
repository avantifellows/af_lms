import { query } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  canAccessBlendedStudent,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import { storedLegacyActionItems } from "./blended-learning-legacy-conversations";
import type { OpenDraftState } from "./blended-learning-mentees";
import { getObjectText, headObject, presignDocumentPage } from "./s3";

const PHOTO_URL_TTL_SECONDS = 300; // 5 minutes
const RECORDING_URL_TTL_SECONDS = 300; // 5 minutes

// Blended Learning read model: one Mentee's detail page and a Conversation's
// on-demand notes and photos (server-only). Every read checks
// canAccessBlendedStudent first; out of scope reads as null (a 404).

export type ActionItemOwner = "student" | "mentor" | "parent";
export type ActionItem = {
  id: number;
  text: string;
  owner: ActionItemOwner;
  status: "open" | "done";
};
// An open Action Item with the date of the Conversation that agreed it, or,
// for one pushed from a Common Action Item (`common`), the date it was pushed.
export type OpenActionItem = Omit<ActionItem, "status"> & { agreedOn: string; common?: boolean };
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
      // Saved from a Conversation Draft with these S3 objects. Only admins
      // may play or read them (ADR 0010).
      hasRecording: boolean;
      hasTranscript: boolean;
      photoCount: number;
      actionItems: ActionItem[];
      flags: MentorFlag[];
    };

// One of the Profile Doc conversation's action items. `index` is its place
// in the stored array, which a tick updates by; a ticked item has doneAt.
export type LegacyActionItemView = {
  index: number;
  text: string;
  owner: ActionItemOwner;
  doneAt: string | null;
  doneByEmail: string | null;
};

// The latest conversation in the Student's legacy Google Profile Doc, from
// the links importer's snapshot. Before the first Conversation in the app it
// is shown in full; after it, only while one of its action items is open.
export type LegacyConversation = {
  // A Conversation has been logged in the app: show the action items only.
  superseded: boolean;
  // legacy_last_contact_on: the date of that Profile Doc entry.
  occurredOn: string | null;
  summary: string;
  actionItems: LegacyActionItemView[];
  profileDocUrl: string | null;
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
  // Open Action Items from earlier Conversations and Common Action Items,
  // newest first by agreed (or pushed) date.
  openActionItems: OpenActionItem[];
  // The Profile Doc's latest conversation: in full while the Student has no
  // Conversation in the app (Attempts don't count), then only while one of its
  // action items is still open.
  legacyConversation: LegacyConversation | null;
  // The Mentor of the Student's active Mapping, for an admin's way back to
  // that Mentor's list.
  mentor: { userId: number; firstName: string };
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
  legacy_last_contact_on: string | null;
  legacy_conversation_summary: string | null;
  legacy_action_items: unknown;
  open_draft_id: number | string | null;
  open_draft_state: OpenDraftState | null;
  mentor_user_id: number | string;
  mentor_first_name: string;
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
  has_recording: boolean;
  has_transcript: boolean;
  photo_count: number | string;
};

// Two numbers are the same contact when their last ten digits match, so a
// "+91 " prefix or spacing does not show a duplicate WhatsApp line.
function sameNumber(a: string, b: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, "").slice(-10);
  return digits(a) === digits(b);
}

export function present(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null;
}

// A Student's contact numbers from `user.phone` and `user.whatsapp_phone`,
// WhatsApp only when it differs. Parent phones are never read.
export function contactNumbers(
  phone: string | null,
  whatsapp: string | null
): { phone: string | null; whatsappPhone: string | null } {
  const main = present(phone);
  const other = present(whatsapp);
  return { phone: main, whatsappPhone: other && !(main && sameNumber(main, other)) ? other : null };
}

type ActionItemRow = {
  conversation_id: number | string | null;
  id: number | string;
  text: string;
  owner: ActionItemOwner;
  status: "open" | "done";
  // IST date it was added: when a Common Action Item was pushed.
  added_on: string;
};

// Rows by Conversation; Action Items pushed from a Common Action Item have no
// Conversation and are left out.
function groupBy<T extends { conversation_id: number | string | null }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    if (row.conversation_id === null) continue;
    const key = Number(row.conversation_id);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function openItem(item: ActionItemRow, agreedOn: string): OpenActionItem {
  return {
    id: Number(item.id),
    text: item.text,
    owner: item.owner,
    agreedOn,
    common: item.conversation_id === null,
  };
}

// Open items from each Conversation (newest Conversation first) and from
// Common Action Items, ordered newest first by date; on the same date the
// Conversations' order holds and pushed items follow.
function openActionItems(
  entries: EntryRow[],
  itemsByConversation: Map<number, ActionItemRow[]>,
  items: ActionItemRow[]
): OpenActionItem[] {
  const fromConversations = entries.flatMap((entry) =>
    (itemsByConversation.get(Number(entry.id)) ?? [])
      .filter((item) => item.status === "open")
      .map((item) => openItem(item, entry.occurred_on))
  );
  const pushed = items
    .filter((item) => item.conversation_id === null && item.status === "open")
    .map((item) => openItem(item, item.added_on));
  return [...fromConversations, ...pushed].sort((a, b) => b.agreedOn.localeCompare(a.agreedOn));
}

// The Profile Doc snapshot: in full before the first Conversation in the
// app, then only while an action item is open; null when there is none.
function legacyConversation(profile: ProfileRow, entries: EntryRow[]): LegacyConversation | null {
  const summary = present(profile.legacy_conversation_summary);
  if (!summary) return null;
  const actionItems = storedLegacyActionItems(profile.legacy_action_items).map(
    (item): LegacyActionItemView => ({
      index: item.index,
      text: item.text,
      owner: item.owner,
      doneAt: item.done_at,
      doneByEmail: item.done_by_email,
    })
  );
  const superseded = entries.some((entry) => entry.kind === "conversation");
  if (superseded && actionItems.every((item) => item.doneAt !== null)) return null;
  return { superseded, occurredOn: profile.legacy_last_contact_on, summary, actionItems, profileDocUrl: present(profile.profile_doc_url) };
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
            links.legacy_last_contact_on::text AS legacy_last_contact_on,
            links.legacy_conversation_summary, links.legacy_action_items,
            open_draft.id AS open_draft_id, open_draft.state AS open_draft_state,
            mapping.mentor_user_id,
            COALESCE(NULLIF(TRIM(mentor.first_name), ''), NULLIF(TRIM(mentor.last_name), ''),
                     mentor.email, CONCAT('Mentor ', mapping.mentor_user_id)) AS mentor_first_name
     FROM blended_learning_mentor_mentee_mappings mapping
     JOIN student st ON st.id = mapping.student_id
     LEFT JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
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
              (c.call_recording_s3_key IS NOT NULL) AS has_recording,
              (c.transcript_s3_key IS NOT NULL) AS has_transcript,
              (SELECT count(*) FROM blended_learning_conversation_photos photo
               WHERE photo.conversation_id = c.id) AS photo_count
       FROM blended_learning_conversations c
       WHERE c.student_id = $1
       ORDER BY c.occurred_on DESC, c.id DESC`,
      [studentId]
    ),
    query<ActionItemRow>(
      `SELECT conversation_id, id, text, owner, status,
              ((inserted_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS added_on
       FROM blended_learning_action_items
       WHERE student_id = $1
       ORDER BY conversation_id, position, id`,
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
  const toActionItem = (item: (typeof actionItems)[number]): ActionItem => ({
    id: Number(item.id),
    text: item.text,
    owner: item.owner,
    status: item.status,
  });
  const flagsByConversation = groupBy(flags);

  return {
    studentId,
    name: [profile.first_name, profile.last_name].filter(Boolean).join(" "),
    gender: profile.gender,
    grade: profile.grade === null ? null : Number(profile.grade),
    programName: profile.program_name,
    ...contactNumbers(profile.phone, profile.whatsapp_phone),
    profileDocUrl: present(profile.profile_doc_url),
    screenerUrl: present(profile.screener_url),
    openDraft:
      profile.open_draft_id === null || profile.open_draft_state === null
        ? null
        : { id: Number(profile.open_draft_id), state: profile.open_draft_state },
    mentor: { userId: Number(profile.mentor_user_id), firstName: profile.mentor_first_name },
    legacyConversation: legacyConversation(profile, entries),
    openActionItems: openActionItems(entries, itemsByConversation, actionItems),
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
        hasRecording: entry.has_recording,
        hasTranscript: entry.has_transcript,
        photoCount: Number(entry.photo_count),
        actionItems: (itemsByConversation.get(id) ?? []).map(toActionItem),
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
  const rows = await query<{
    student_id: number | string;
    kind: string;
    notes_html: string | null;
    call_recording_s3_key: string | null;
    transcript_s3_key: string | null;
  }>(
    `SELECT student_id, kind, notes_html, call_recording_s3_key, transcript_s3_key
     FROM blended_learning_conversations WHERE id = $1`,
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

// Only a 404 from HEAD means the lifecycle rule has removed the recording;
// any other HEAD failure still gets a presigned GET.
async function recordingStillStored(s3Key: string): Promise<boolean> {
  try {
    return (await headObject(s3Key)) !== null;
  } catch (err) {
    // Never log the S3 key; the error name is enough to triage.
    console.error("Blended Learning recording HEAD failed:", err instanceof Error ? err.name : "unknown");
    return true;
  }
}

export type RecordingPlayback = { expired: true } | { expired: false; url: string };

// A saved Conversation's Call Recording (admins only, ADR 0010). Null when
// out of scope or the Conversation has no recording.
export async function getRecordingPlayback(
  access: BlendedLearningAccess,
  conversationId: number
): Promise<RecordingPlayback | null> {
  const conversation = await conversationInScope(access, conversationId);
  const s3Key = conversation?.call_recording_s3_key;
  if (!s3Key) return null;
  if (!(await recordingStillStored(s3Key))) return { expired: true };
  const url = await presignDocumentPage({ s3Key, ttlSeconds: RECORDING_URL_TTL_SECONDS });
  return { expired: false, url };
}

export type TranscriptTurn = { speaker: string | null; text: string };
export type Transcript = { expired: true } | { expired: false; turns: TranscriptTurn[] };

// A saved Conversation's transcript as speaker turns (admins only, ADR 0010).
// Null when out of scope or the Conversation has no transcript.
export async function getTranscript(
  access: BlendedLearningAccess,
  conversationId: number
): Promise<Transcript | null> {
  const conversation = await conversationInScope(access, conversationId);
  const s3Key = conversation?.transcript_s3_key;
  if (!s3Key) return null;
  const body = await getObjectText(s3Key);
  if (body === null) return { expired: true };
  return { expired: false, turns: speakerTurns(JSON.parse(body)) };
}

type ScribeWord = { text?: unknown; type?: unknown; speaker_id?: unknown };

// etl-next stores the raw ElevenLabs Scribe response. Consecutive words by
// one `speaker_id` form a turn, and speakers are numbered in the order they
// first talk (as etl-next's drafting prompt numbers them). Without words, or
// when any word lacks a speaker, the whole `text` is one unlabelled turn.
function speakerTurns(scribe: { text?: unknown; words?: unknown }): TranscriptTurn[] {
  const words = (Array.isArray(scribe.words) ? scribe.words : []).filter(
    (word): word is ScribeWord => typeof word === "object" && word !== null && word.type !== "spacing"
  );
  if (words.length === 0 || !words.every((word) => typeof word.speaker_id === "string" && word.speaker_id)) {
    const text = String(scribe.text ?? "").trim();
    return text ? [{ speaker: null, text }] : [];
  }

  const speakerNumbers = new Map<string, number>();
  const turns: { speaker: string; texts: string[] }[] = [];
  for (const word of words) {
    const id = word.speaker_id as string;
    if (!speakerNumbers.has(id)) speakerNumbers.set(id, speakerNumbers.size + 1);
    const speaker = `Speaker ${speakerNumbers.get(id)}`;
    if (turns.at(-1)?.speaker !== speaker) turns.push({ speaker, texts: [] });
    const text = String(word.text ?? "").trim();
    if (text) turns.at(-1)!.texts.push(text);
  }
  return turns.map((turn) => ({ speaker: turn.speaker, text: turn.texts.join(" ") }));
}
