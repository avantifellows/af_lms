import { query } from "@/lib/db";

// College/branch pickers. Search is "every typed word appears, any order", and
// common abbreviations expand, so "nit surathkal" finds "National Institute Of
// Technology Karnataka Surathkal".
// Source: the Postgres college / branch tables.

export interface ReferenceOption {
  code: string;
  name: string;
  meta: string;
}

const MAX_WORDS = 5;
const LIMIT = 20;

function escapeLike(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Common college abbreviations → words that must all appear in the full name.
// College names are stored spelled out, so "NIT" never matches on its own.
const COLLEGE_ABBREVIATIONS: Record<string, string[]> = {
  iit: ["indian", "institute", "technology"],
  nit: ["national", "institute", "technology"],
  iiit: ["institute", "information", "technology"],
  iiitdm: ["institute", "information", "technology", "design", "manufacturing"],
  iisc: ["indian", "institute", "science"],
  iiser: ["indian", "institute", "science", "education", "research"],
  nift: ["national", "institute", "fashion", "technology"],
  aiims: ["all", "india", "institute", "medical", "sciences"],
  jntu: ["jawaharlal", "nehru", "technological", "university"],
  vit: ["vellore", "institute", "technology"],
  bits: ["birla", "institute", "technology", "science"],
  iim: ["indian", "institute", "management"],
  gmc: ["government", "medical", "college"],
  gec: ["government", "engineering", "college"],
  cbit: ["chaitanya", "bharathi", "institute", "technology"],
  dtu: ["delhi", "technological", "university"],
  nsut: ["netaji", "subhas", "university", "technology"],
  igdtuw: ["indira", "gandhi", "delhi", "technical", "university", "women"],
  pec: ["punjab", "engineering", "college"],
};

/** "Every word appears in one of the columns", as SQL with $n params starting at `first`. */
function wordFilter(q: string, columns: string[], first: number, abbreviations: Record<string, string[]> = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  const params: string[] = [];
  const like = (word: string) => {
    params.push(`%${escapeLike(word)}%`);
    const n = first + params.length - 1;
    return `(${columns.map((c) => `${c} ILIKE $${n}`).join(" OR ")})`;
  };
  const sql = words
    .map((w) => {
      const expansion = abbreviations[w.replace(/[^a-z]/g, "")];
      // An abbreviation matches either literally or as all of its spelled-out words.
      return expansion ? `(${like(w)} OR (${expansion.map(like).join(" AND ")}))` : like(w);
    })
    .join(" AND ");
  return { sql, params };
}

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

export async function searchColleges(q: string): Promise<ReferenceOption[]> {
  if (q.trim().length < 2) return [];
  const f = wordFilter(q, ["name", "college_id"], 2, COLLEGE_ABBREVIATIONS);
  const rows = await query<{ college_id: string; name: string; district: string | null; state: string | null }>(
    `SELECT college_id, name, district, state FROM college
     WHERE college_id IS NOT NULL AND ${f.sql}
     ORDER BY lower(college_id) = $1 DESC, length(name), name LIMIT ${LIMIT}`,
    [q.trim().toLowerCase(), ...f.params],
  );
  return rows.map((r) => ({ code: r.college_id, name: clean(r.name), meta: [r.district, r.state].filter(Boolean).join(", ") }));
}

export interface CodeInfo {
  /** college.id / branch.id — what the alumni table stores. */
  id: string;
  name: string;
}

/** Id and name for each college / branch code that exists. A code missing from the result doesn't exist. */
export async function lookupCodes(colleges: string[], branches: string[]): Promise<Map<string, CodeInfo>> {
  if (!colleges.length && !branches.length) return new Map();
  const rows = await query<{ code: string; id: string; name: string }>(
    `SELECT college_id AS code, id, name FROM college WHERE college_id = ANY($1::text[])
     UNION ALL
     SELECT branch_id, id, name FROM branch WHERE branch_id = ANY($2::text[])`,
    [colleges, branches],
  );
  return new Map(rows.map((r) => [r.code, { id: String(r.id), name: clean(r.name) }]));
}

/** Shortest names first, so the generic branch ("VLSI") ranks above "(4 Years, ...)" variants. */
export async function searchBranches(q: string): Promise<ReferenceOption[]> {
  if (q.trim().length < 2) return [];
  const f = wordFilter(q, ["name", "branch_id"], 2);
  const rows = await query<{ branch_id: string; name: string }>(
    `SELECT branch_id, name FROM branch
     WHERE branch_id IS NOT NULL AND ${f.sql}
     ORDER BY lower(branch_id) = $1 DESC, length(name), name LIMIT ${LIMIT}`,
    [q.trim().toLowerCase(), ...f.params],
  );
  return rows.map((r) => ({ code: r.branch_id, name: clean(r.name), meta: "" }));
}
