// Exam acknowledgements: the confirmation page an exam portal
// issues once a Student's application form is submitted. Client-safe, so the
// Exams tab and the upload route agree on which slots a registration has.
//
// An acknowledgement is an `lms_student_documents` row of its own type, tied
// to one `student_exam_record` and, for an exam that runs in sessions, to one
// sitting. The DB Service enforces the same rules (one current document per
// registration and sitting, a sitting the Student applied for) and retires an
// acknowledgement when its sitting is unticked or its registration removed.

import { examSessionsFor } from "@/lib/competitive-exams";

/**
 * The `document_type` of an acknowledgement. Deliberately not in
 * `DOCUMENT_TYPES`: the Documents tab neither offers nor lists it, because an
 * acknowledgement with no registration says nothing about which exam it is for.
 */
export const EXAM_ACK_DOCUMENT_TYPE = "exam_acknowledgement";

/** One page of a stored acknowledgement, without its S3 key. */
export interface ExamAcknowledgementPage {
  page_number: number;
  mime_type: string;
}

/** A current (not deleted) acknowledgement, as the Exams tab sees it. */
export interface ExamAcknowledgement {
  /** `lms_student_documents.id`. */
  id: number;
  /** The sitting, e.g. 1 or 2 for JEE Mains; null for an exam without sessions. */
  exam_session: number | null;
  pages: ExamAcknowledgementPage[];
  uploaded_by: string;
  uploaded_at: string;
}

/**
 * The acknowledgement slots a stored registration has: one per sitting stored
 * in `sessions_applied` (only JEE Mains has sittings: Session 1 and Session 2),
 * otherwise a single slot (`null`). A JEE Mains registration with no sitting
 * saved has no slot yet.
 *
 * Goes by the stored sittings, as the DB Service does when it checks an upload,
 * so the two can never disagree — even about a registration some other writer
 * gave sittings to.
 */
export function acknowledgementSlots(
  examName: string,
  sessionsApplied: number[] | null | undefined,
): (number | null)[] {
  const applied = [...new Set(sessionsApplied ?? [])].sort((a, b) => a - b);
  if (applied.length > 0) return applied;
  return examSessionsFor(examName).length > 0 ? [] : [null];
}

/** "Session 1 exam acknowledgement", or "Exam acknowledgement" for an exam without sessions. */
export function acknowledgementLabel(session: number | null): string {
  return session === null ? "Exam acknowledgement" : `Session ${session} exam acknowledgement`;
}

/**
 * Parse the `exam_session` an upload names, against the registration's slots.
 * Absent or blank means no sitting; anything else must be one of the slots.
 */
export function parseAcknowledgementSession(
  raw: FormDataEntryValue | null,
  slots: (number | null)[],
): { ok: true; session: number | null } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  let session: number | null = null;
  if (text) {
    if (!/^\d+$/.test(text)) return { ok: false, error: "exam_session is not valid" };
    session = Number(text);
  }
  if (!slots.includes(session)) {
    return {
      ok: false,
      error:
        session === null
          ? "Pick the session this acknowledgement is for"
          : `Session ${session} is not a session this Student applied for`,
    };
  }
  return { ok: true, session };
}
