// Talk to First policy for Blended Learning Mentoring. Pure and
// dependency-free, so the Mentee list and the admin Mentor cards share it and
// client code may import it. Every date is an IST calendar date (YYYY-MM-DD)
// and days_since = today_IST − date.

export type BlendedEntryKind = "conversation" | "attempt";

export type TalkToFirstInput = {
  // Kind of the Mentee's latest entry: highest (occurred_on, id) across
  // Conversations and Attempts. null when nothing is logged.
  latestEntryKind: BlendedEntryKind | null;
  lastConversationOn: string | null;
  // First day of the optional pre-app legacy last-contact month.
  legacyMonth: string | null;
  today: string;
};

// "Why now" reasons, in display order.
export type TalkToFirstReason = "attempt" | "no_contact" | "gap_30";

export type TalkToFirstResult = {
  inTalkToFirst: boolean;
  reasons: TalkToFirstReason[];
  // Days since Last Contact; null when there is none.
  daysSince: number | null;
};

const GAP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export type LoggedEntry = { occurredOn: string; id: number };

// The latest entry is the highest (occurred_on, id) across the Mentee's
// latest Conversation and latest Attempt.
export function latestEntryKind(
  latestConversation: LoggedEntry | null,
  latestAttempt: LoggedEntry | null
): BlendedEntryKind | null {
  if (latestConversation === null) return latestAttempt === null ? null : "attempt";
  if (latestAttempt === null) return "conversation";
  if (latestAttempt.occurredOn !== latestConversation.occurredOn) {
    return latestAttempt.occurredOn > latestConversation.occurredOn ? "attempt" : "conversation";
  }
  return latestAttempt.id > latestConversation.id ? "attempt" : "conversation";
}

function lastDayOfMonth(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export type LastContact = { on: string; source: "conversation" | "legacy" };

// Last Contact is the latest Conversation's date, or the legacy month's last
// day when the Mentee has no Conversation. Attempts never count.
export function lastContactOf(
  lastConversationOn: string | null,
  legacyMonth: string | null
): LastContact | null {
  if (lastConversationOn !== null) return { on: lastConversationOn, source: "conversation" };
  if (legacyMonth !== null) return { on: lastDayOfMonth(legacyMonth), source: "legacy" };
  return null;
}

export function talkToFirst(input: TalkToFirstInput): TalkToFirstResult {
  const lastContact = lastContactOf(input.lastConversationOn, input.legacyMonth);
  const daysSince =
    lastContact === null ? null : dayNumber(input.today) - dayNumber(lastContact.on);
  const reasons: TalkToFirstReason[] = [];
  if (input.latestEntryKind === "attempt") reasons.push("attempt");
  if (lastContact === null) reasons.push("no_contact");
  if (daysSince !== null && daysSince >= GAP_DAYS) reasons.push("gap_30");
  return { inTalkToFirst: reasons.length > 0, reasons, daysSince };
}

// The Student list's two groups, by their labels: any "Why now" reason puts
// a Mentee in Talk to first.
export type MenteeGroup = "Talk to first" | "Everyone else";

export function menteeGroup(reasons: readonly TalkToFirstReason[]): MenteeGroup {
  return reasons.length > 0 ? "Talk to first" : "Everyone else";
}

// "Talked to in the last week" means days_since < 7.
export function talkedToInLastWeek(daysSince: number | null): boolean {
  return daysSince !== null && daysSince < 7;
}

// "30 days or more" means days_since ≥ 30 or no Last Contact at all.
export function thirtyDaysOrMore(daysSince: number | null): boolean {
  return daysSince === null || daysSince >= GAP_DAYS;
}

export type TalkToFirstSortable = {
  name: string;
  latestEntryKind: BlendedEntryKind | null;
  reasons: readonly TalkToFirstReason[];
  daysSince: number | null;
};

// Sort order: latest entry is an Attempt first, then more reasons first, then
// the larger gap first (no Last Contact counts as the largest), then name A–Z.
export function compareTalkToFirst(a: TalkToFirstSortable, b: TalkToFirstSortable): number {
  const attempt = Number(b.latestEntryKind === "attempt") - Number(a.latestEntryKind === "attempt");
  if (attempt !== 0) return attempt;
  if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;
  const gapA = a.daysSince ?? Number.POSITIVE_INFINITY;
  const gapB = b.daysSince ?? Number.POSITIVE_INFINITY;
  if (gapA !== gapB) return gapA < gapB ? 1 : -1;
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}
