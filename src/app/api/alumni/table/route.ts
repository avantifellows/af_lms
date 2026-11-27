import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { filterTable, loadAlumniTable, summarizeTable, tableYears } from "@/lib/alumni/table";
import { readTableRequest } from "@/lib/alumni/table-request";

/** Rows per page of the table. */
const PAGE_SIZE = 100;

/**
 * The alumni team's "missing data" table, for one school or every school in
 * the caller's alumni scope: a page of rows, the summary counts and the
 * filter options. Query string: see table-request.ts.
 */
export async function GET(request: Request) {
  const { school, filters, page, refs } = readTableRequest(request.url);
  const auth = await authorizeAlumni(school ? { schoolCode: school } : {});
  if (!auth.ok) return auth.response;

  try {
    const rows = await loadAlumniTable(auth.permission, school);
    const matching = filterTable(rows, filters);
    // "Select all matching": who, not a page.
    if (refs) return NextResponse.json({ refs: matching.map((r) => ({ kind: r.kind, id: r.id, name: r.name })) });
    const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    const current = Math.min(page, pageCount);
    const schools = new Map(rows.filter((r) => r.schoolCode).map((r) => [r.schoolCode, r.schoolName]));
    return NextResponse.json({
      rows: matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
      total: matching.length,
      page: current,
      pageCount,
      summary: summarizeTable(rows, filters),
      years: tableYears(rows),
      schools: [...schools].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    console.error("[alumni/table]", error);
    return NextResponse.json({ error: "Couldn't load the alumni table." }, { status: 500 });
  }
}
