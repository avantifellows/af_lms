import { TABLE_FIELDS, type FieldFilter, type TableField, type TableFilters } from "./table-fields";

// The "missing data" table's query string, shared by the table route and the
// download route so both always apply the same filters:
//   ?school=CODE        one school (else every school in scope)
//   &year=2024-2025     pass-out years, comma-separated
//   &record=added|not-added
//   &q=name-or-afid
//   &<field>=filled|missing   for each TABLE_FIELDS key
//   &page=1
//   &refs=1             every matching row's id instead of a page (bulk select)

export interface TableRequest {
  school?: string;
  filters: TableFilters;
  page: number;
  /** Every matching row's ref instead of a page. */
  refs: boolean;
}

const MAX_Q = 100;

export function readTableRequest(url: string): TableRequest {
  const p = new URL(url).searchParams;
  const fields: Partial<Record<TableField, FieldFilter>> = {};
  for (const { key } of TABLE_FIELDS) {
    const want = p.get(key);
    if (want === "filled" || want === "missing") fields[key] = want;
  }
  const record = p.get("record");
  const years = (p.get("year") ?? "").split(",").map((y) => y.trim()).filter((y) => /^\d{4}-\d{4}$/.test(y));
  const page = Number(p.get("page"));
  return {
    school: p.get("school")?.trim() || undefined,
    filters: {
      years,
      record: record === "added" || record === "not-added" ? record : undefined,
      fields,
      q: (p.get("q") ?? "").slice(0, MAX_Q),
    },
    page: Number.isInteger(page) && page > 0 ? page : 1,
    refs: p.get("refs") === "1",
  };
}
