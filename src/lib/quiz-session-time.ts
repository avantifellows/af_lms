const IST_OFFSET_MINUTES = 5.5 * 60;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
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
