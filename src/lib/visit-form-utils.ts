export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const ACTION_ADDITIONAL_NOTES_KEY = "additional_notes";
export const ACTION_ADDITIONAL_NOTES_LABEL = "Additional Notes or Concerns";

export function readActionAdditionalNotes(data: unknown): string {
  if (!isPlainObject(data)) {
    return "";
  }

  const value = data[ACTION_ADDITIONAL_NOTES_KEY];
  return typeof value === "string" ? value : "";
}

export function appendActionAdditionalNotes(
  target: Record<string, unknown>,
  source: unknown
): void {
  const notes = readActionAdditionalNotes(source);
  if (notes.length > 0) {
    target[ACTION_ADDITIONAL_NOTES_KEY] = notes;
  }
}

export function validateActionAdditionalNotes(
  payload: Record<string, unknown>
): string[] {
  const value = payload[ACTION_ADDITIONAL_NOTES_KEY];
  if (value !== undefined && typeof value !== "string") {
    return [`${ACTION_ADDITIONAL_NOTES_KEY} must be a string`];
  }

  return [];
}
