// THE rule for a Student's pre-app legacy last-contact date
// (blended_learning_student_links.legacy_last_contact_on). Every input the
// rule might use is gathered here, so changing the rule is a one-line edit.
//
// Product owner, 2026-10-23: the latest dated conversation in the Profile Doc
// only. The Profile Dashboard Sheet's monthly call counts are not used, and a
// doc that is unreadable or has no dated conversation gives NULL (the Student
// then shows as "no contact" in Talk to first).

export type LegacyLastContactEvidence = {
  // Latest dated conversation in the Profile Doc (YYYY-MM-DD); null when none.
  profileDocConversationOn: string | null;
  // First day of the Sheet's latest month with a call count above zero.
  // Gathered but not used by the current rule.
  sheetMonth: string | null;
};

export function legacyLastContactOn(evidence: LegacyLastContactEvidence): string | null {
  return evidence.profileDocConversationOn;
}
