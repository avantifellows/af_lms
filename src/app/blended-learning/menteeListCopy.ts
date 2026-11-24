import type { MenteeRow } from "@/lib/blended-learning-mentees";
import type { TalkToFirstReason } from "@/lib/blended-learning-talk-to-first";

// Display copy for the Student list's cells. Pure, so the list's table and
// cards and the log form's saved summary say the same thing. `today` is the
// IST calendar date (YYYY-MM-DD); without it every date keeps its year.

export type WhyNowTag = { reason: TalkToFirstReason; text: string; tone: "danger" | "warning" };

function utcDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function format(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(utcDate(date));
}

// "9 Sep" this year, "9 Sep 2025" otherwise.
export function shortDate(date: string, today?: string): string {
  const sameYear = today !== undefined && today.slice(0, 4) === date.slice(0, 4);
  return format(date, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function daysAgo(days: number): string {
  if (days === 0) return "Today";
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function notReachable(mentee: MenteeRow, today?: string): string {
  return mentee.lastAttemptOn ? `Unreachable · ${shortDate(mentee.lastAttemptOn, today)}` : "Unreachable";
}

function notContacted(mentee: MenteeRow): string {
  return `No contact · ${mentee.daysSince} days`;
}

export function whyNowTags(mentee: MenteeRow, today?: string): WhyNowTag[] {
  return mentee.reasons.map((reason) => {
    if (reason === "attempt") return { reason, text: notReachable(mentee, today), tone: "danger" };
    if (reason === "no_contact") return { reason, text: "No conversation", tone: "warning" };
    return { reason, text: notContacted(mentee), tone: "warning" };
  });
}
