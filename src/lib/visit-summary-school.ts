// The School page of the School Visit Summary (`/school-visit-summary/schools/[code]`; server-only:
// reads through `@/lib/db`).
import { query } from "@/lib/db";
import { buildVisitSummaryScopePredicate, type VisitsActor } from "@/lib/visits-policy";

export interface VisitSummarySchool {
  code: string;
  name: string;
  region: string | null;
}

// The School, when the actor may see it on the Visit Summary: inside their summary scope and with
// an active physical Centre (#470). Null otherwise, so the page can't reveal that it exists.
export async function getVisitSummarySchool(
  actor: VisitsActor,
  schoolCode: string
): Promise<VisitSummarySchool | null> {
  const scope = buildVisitSummaryScopePredicate(actor, {
    startIndex: 2,
    schoolCodeColumn: "s.code",
    schoolRegionColumn: "s.region",
  });
  const rows = await query<VisitSummarySchool>(
    `SELECT s.code, s.name, s.region
     FROM school s
     WHERE s.code = $1
       AND EXISTS (
         SELECT 1 FROM centres c
         WHERE c.school_id = s.id AND c.is_physical AND c.is_active
       )
       ${scope.clause ? `AND ${scope.clause}` : ""}
     LIMIT 1`,
    [schoolCode, ...scope.params]
  );
  return rows[0] ?? null;
}

// Seat roles that teach (every seat role except the PM tiers).
const TEACHING_SEAT_ROLES = ["physics", "chemistry", "maths", "biology", "apc", "subject_tbd"];

// `centres.type_code` → its tag. CoE and Nodal stay apart; any other physical type keeps its own
// code as the tag.
const CENTRE_TYPE_TAGS: Record<string, string> = { coe: "CoE", nodal: "Nodal" };
const UNTYPED_CENTRE_TAG = "Other";

export interface TeacherSeat {
  subject: string;
  // Null for a vacant seat.
  name: string | null;
}

export interface TeacherGroup {
  tag: string;
  seats: TeacherSeat[];
}

interface TeacherSeatRow {
  type_code: string | null;
  role: string;
  name: string | null;
  teacher_subject: string | null;
}

function seatSubject({ role, teacher_subject }: TeacherSeatRow): string {
  if (role === "subject_tbd") {
    return (teacher_subject ?? "Subject TBD").toUpperCase();
  }
  return role.toUpperCase();
}

function compareSeats(a: TeacherSeat, b: TeacherSeat): number {
  if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
  if (a.name === null || b.name === null) return a.name === b.name ? 0 : a.name === null ? 1 : -1;
  return a.name.localeCompare(b.name);
}

function tagRank(tag: string): number {
  if (tag === CENTRE_TYPE_TAGS.coe) return 0;
  if (tag === CENTRE_TYPE_TAGS.nodal) return 1;
  if (tag === UNTYPED_CENTRE_TAG) return 3;
  return 2;
}

// Active teaching seats at the School's active physical Centres, grouped by Centre type (#470).
// A `subject_tbd` seat shows its teacher's own subject when one is set.
export async function getVisitSummarySchoolTeachers(schoolCode: string): Promise<TeacherGroup[]> {
  const rows = await query<TeacherSeatRow>(
    `SELECT c.type_code,
            cp.role,
            CASE WHEN cp.user_id IS NOT NULL THEN
              COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)
            END AS name,
            CASE WHEN cp.role = 'subject_tbd' THEN (
              SELECT sub.name->0->>'subject'
              FROM teacher t
              JOIN subject sub ON sub.id = t.subject_id
              WHERE t.user_id = cp.user_id
              ORDER BY t.is_af_teacher DESC, t.id
              LIMIT 1
            ) END AS teacher_subject
     FROM centre_positions cp
     JOIN centres c ON c.id = cp.centre_id AND c.is_physical AND c.is_active
     JOIN school s ON s.id = c.school_id
     LEFT JOIN "user" u ON u.id = cp.user_id
     WHERE s.code = $1
       AND cp.deleted_at IS NULL
       AND cp.role = ANY($2)`,
    [schoolCode, TEACHING_SEAT_ROLES]
  );

  const groups = new Map<string, TeacherSeat[]>();
  for (const row of rows) {
    const tag = row.type_code ? CENTRE_TYPE_TAGS[row.type_code] ?? row.type_code : UNTYPED_CENTRE_TAG;
    const seats = groups.get(tag) ?? [];
    seats.push({ subject: seatSubject(row), name: row.name });
    groups.set(tag, seats);
  }

  return [...groups.entries()]
    .map(([tag, seats]) => ({ tag, seats: seats.sort(compareSeats) }))
    .sort((a, b) => tagRank(a.tag) - tagRank(b.tag) || a.tag.localeCompare(b.tag));
}
