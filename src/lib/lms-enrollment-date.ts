function istDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function deriveLmsEnrollmentPeriod(now = new Date()): {
  start_date: string;
  academic_year: string;
} {
  const { year, month, day } = istDateParts(now);
  const start_date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const academicStart = month >= 4 ? year : year - 1;
  return {
    start_date,
    academic_year: `${academicStart}-${academicStart + 1}`,
  };
}
