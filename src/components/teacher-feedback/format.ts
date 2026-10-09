export const DEFAULT_DURATION_HOURS = 24;

/** Round times come back from Postgres in UTC without an offset. */
export function parseDbTime(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value.includes("T") || value.includes("Z") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-09" in IST — rounds are monthly, and a month boundary is an IST one. */
export function istMonth(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" });
}

export function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const d = parseDbTime(value);
  if (!d) return value;
  return d.toLocaleString("en-IN", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Whole-number percent; one decimal would claim precision 40 students don't give. */
export function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}
