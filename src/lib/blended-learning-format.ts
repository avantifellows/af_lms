// Blended Learning's shared session-detail values, labels and calendar-date
// helpers. Pure, with no server imports: pages, client components and server
// use cases all read them from here.

export const MODES = ["call", "in_person"] as const;
export const SPOKE_WITH = ["student", "parent_or_sibling", "both"] as const;

const MODE_LABEL: Record<(typeof MODES)[number], string> = { call: "Call", in_person: "In person" };
const SPOKE_WITH_LABEL: Record<(typeof SPOKE_WITH)[number], string> = {
  student: "Student",
  parent_or_sibling: "Parent or sibling",
  both: "Student and parent",
};

// A Conversation's mode, who was spoken with and its length, as one line.
export function describeSession(session: {
  mode: (typeof MODES)[number];
  spokeWith: (typeof SPOKE_WITH)[number];
  durationMinutes: number;
}): string {
  return [MODE_LABEL[session.mode], SPOKE_WITH_LABEL[session.spokeWith], `${session.durationMinutes} min`].join(" · ");
}

// A `YYYY-MM-DD` calendar date as "5 Mar 2026", never shifted by time zone.
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

// A real `YYYY-MM-DD` calendar date (no 31 February).
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

export function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
