import { parse } from "csv-parse/browser/esm/sync";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvText(text: string): ParsedCsv {
  const records = (
    parse(text, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][]
  )
    .map((row) => row.map((value) => value.trim()))
    .filter((row) => row.some((value) => value.length > 0));

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0];
  const rows = records.slice(1).map((record) =>
    headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = record[index] ?? "";
      return row;
    }, {})
  );

  return { headers, rows };
}
