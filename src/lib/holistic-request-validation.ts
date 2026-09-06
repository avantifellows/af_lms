import { isHolisticMentorshipProgramId } from "@/lib/constants";

export function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function positiveIntegerString(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function holisticProgramId(value: unknown): number | null {
  // Query-string values arrive as strings, while JSON mutation bodies should
  // be checked for a numeric type by their route before calling this helper.
  // Missing/null/empty input is never a valid Holistic Program.
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return isHolisticMentorshipProgramId(parsed) ? parsed : null;
}

/** Parse the numeric Program contract used by Holistic JSON mutation bodies. */
export function holisticJsonProgramId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? holisticProgramId(value)
    : null;
}

export function validSchoolCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
