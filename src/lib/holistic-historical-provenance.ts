export const HISTORICAL_SOURCE_TIMEZONE = "Asia/Calcutta" as const;

export function hasValidHistoricalSourceProvenance(input: {
  sourceStartedAt: unknown;
  sourceEndedAt: unknown;
  sourceTimezone: unknown;
}): boolean {
  if (input.sourceTimezone !== HISTORICAL_SOURCE_TIMEZONE ||
      typeof input.sourceStartedAt !== "string" ||
      (input.sourceEndedAt !== null && typeof input.sourceEndedAt !== "string")) {
    return false;
  }
  const startedAt = parseSourceTimestamp(input.sourceStartedAt);
  const endedAt = input.sourceEndedAt === null
    ? null
    : parseSourceTimestamp(input.sourceEndedAt);
  return startedAt !== null &&
    (input.sourceEndedAt === null || endedAt !== null) &&
    (endedAt === null || endedAt >= startedAt);
}

function parseSourceTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day && parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute && parsed.getUTCSeconds() === second
    ? timestamp
    : null;
}
