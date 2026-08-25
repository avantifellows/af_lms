export function normalizePositiveIntegerIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((id) => (typeof id === "number" ? id : Number.parseInt(String(id), 10)))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
}
