const IST_OFFSET_MINUTES = 5.5 * 60;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addHours(date: Date, hours: number): Date {
  return addMinutes(date, hours * 60);
}

export function utcToISTDate(utcDate: string): string {
  if (!utcDate) return "";
  const parsedDate = new Date(utcDate);
  return addMinutes(parsedDate, IST_OFFSET_MINUTES).toISOString();
}

export function istToUTCDate(istDate: string): string {
  if (!istDate) return "";
  const parsedDate = new Date(istDate);
  return addMinutes(parsedDate, -IST_OFFSET_MINUTES).toISOString();
}

export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join("T");
}

export function dbIstTimestampToUtcIso(value: string | null | undefined): string {
  if (!value) return "";

  const normalized = value.trim().replace(" ", "T");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
  );

  if (!match) {
    return istToUTCDate(value);
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  const utcMillis =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ) -
    IST_OFFSET_MINUTES * 60 * 1000;

  return new Date(utcMillis).toISOString();
}
