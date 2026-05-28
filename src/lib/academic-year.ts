export function getCurrentAcademicYear(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const month = Number(parts.find((part) => part.type === "month")?.value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const startYear = month < 4 ? year - 1 : year;

  return `${startYear}-${startYear + 1}`;
}

export function validateAcademicYear(academicYear: string): boolean {
  const match = academicYear.match(/^(\d{4})-(\d{4})$/);
  if (!match) return false;

  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  return endYear === startYear + 1;
}

export function getAcademicYearChoices(currentAcademicYear = getCurrentAcademicYear()): string[] {
  const [startYearText] = currentAcademicYear.split("-");
  const startYear = Number(startYearText);

  return [0, 1, 2].map((offset) => {
    const year = startYear - offset;
    return `${year}-${year + 1}`;
  });
}
