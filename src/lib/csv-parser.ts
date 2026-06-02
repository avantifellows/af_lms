export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

function normalizeCell(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;

  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(normalizeCell(cell));
      cell = "";
    } else if (char === "\n" || char === "\r") {
      record.push(normalizeCell(cell));
      records.push(record);
      record = [];
      cell = "";
      if (char === "\r" && next === "\n") {
        index += 1;
      }
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || record.length > 0) {
    record.push(normalizeCell(cell));
    records.push(record);
  }

  return records.filter((row) => row.some((value) => value.length > 0));
}

export function parseCsvText(text: string): ParsedCsv {
  const records = parseRecords(text);
  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map(normalizeCell);
  const rows = records.slice(1).map((record) =>
    headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = record[index] ?? "";
      return row;
    }, {})
  );

  return { headers, rows };
}
