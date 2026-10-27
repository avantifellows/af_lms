// The School page of the School Visit Summary (`/school-visit-summary/schools/[code]`; server-only:
// reads through `@/lib/db`).
import { AL_DISPLAY_ORDER } from "@/lib/academic-level";
import { canonicalStream, getStudentAcademicLevelCounts } from "@/lib/bigquery";
import { PROGRAM_ID_TO_LABEL, PROGRAM_IDS } from "@/lib/constants";
import { query } from "@/lib/db";
import { buildVisitSummaryScopePredicate, type VisitsActor } from "@/lib/visits-policy";

export interface VisitSummarySchool {
  code: string;
  name: string;
  region: string | null;
  udise_code: string | null;
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
    `SELECT s.code, s.name, s.region, s.udise_code
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

function centreTag(typeCode: string | null): string {
  return typeCode ? CENTRE_TYPE_TAGS[typeCode] ?? typeCode : UNTYPED_CENTRE_TAG;
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
    const tag = centreTag(row.type_code);
    const seats = groups.get(tag) ?? [];
    seats.push({ subject: seatSubject(row), name: row.name });
    groups.set(tag, seats);
  }

  return [...groups.entries()]
    .map(([tag, seats]) => ({ tag, seats: seats.sort(compareSeats) }))
    .sort((a, b) => tagRank(a.tag) - tagRank(b.tag) || a.tag.localeCompare(b.tag));
}

// Physical-centre classes: the grades whose students prepare for JEE or NEET.
const ACADEMIC_LEVEL_GRADES = [11, 12];

// Canonical `student_stream` → exam. Other streams (CA, CLAT, foundation, none) get no card.
// PCMB students at physical-centre programmes carry M-scale (JEE) levels in dim_student
// (checked 27 Oct 2026, see `.mex/context/visits.md`).
const STREAM_EXAMS: Record<string, AcademicLevelExam> = {
  engineering: "JEE",
  pcm: "JEE",
  pcmb: "JEE",
  medical: "NEET",
  pcb: "NEET",
};
const EXAM_ORDER: AcademicLevelExam[] = ["JEE", "NEET"];

export type AcademicLevelExam = "JEE" | "NEET";

export interface AcademicLevelCard {
  centreId: string;
  centreName: string;
  tag: string;
  grade: number;
  exam: AcademicLevelExam;
  // Levelled students per `academic_level`, best first; only levels with students.
  levels: { level: string; students: number }[];
  // Students with no level yet ("No AL-bearing test yet").
  na: number;
  total: number;
}

export type AcademicLevelCards = { available: true; cards: AcademicLevelCard[] } | { available: false };

interface AcademicLevelCentreRow {
  id: string;
  name: string;
  type_code: string | null;
  program_id: number | null;
}

function levelRank(level: string): number {
  const index = AL_DISPLAY_ORDER.indexOf(level);
  return index === -1 ? AL_DISPLAY_ORDER.length : index;
}

// One card per active physical Centre × grade × exam stream at the School (#470), counted from
// BigQuery `dim_student` for the Centre's programme. JNV NVS Centres are never queried. Any
// BigQuery error makes the whole strip unavailable rather than showing partial counts.
export async function getVisitSummaryAcademicLevelCards(
  school: VisitSummarySchool
): Promise<AcademicLevelCards> {
  const centres = await query<AcademicLevelCentreRow>(
    `SELECT c.id::text AS id, c.name, c.type_code, c.program_id
     FROM centres c
     JOIN school s ON s.id = c.school_id
     WHERE s.code = $1
       AND c.is_physical AND c.is_active
       AND c.program_id IS DISTINCT FROM $2
     ORDER BY c.id`,
    [school.code, PROGRAM_IDS.NVS]
  );
  const udise = school.udise_code || school.code;
  const queried = centres.flatMap((centre) => {
    const program = centre.program_id == null ? undefined : PROGRAM_ID_TO_LABEL[Number(centre.program_id)];
    return program && Number(centre.program_id) !== PROGRAM_IDS.NVS ? [{ centre, program }] : [];
  });

  let counts;
  try {
    counts = await Promise.all(
      queried.map(({ program }) => getStudentAcademicLevelCounts(udise, program, ACADEMIC_LEVEL_GRADES))
    );
  } catch (error) {
    console.error("Visit Summary academic levels unavailable:", error);
    return { available: false };
  }

  const cards: AcademicLevelCard[] = [];
  queried.forEach(({ centre }, index) => {
    const byClass = new Map<string, AcademicLevelCard>();
    for (const row of counts[index]) {
      const exam = STREAM_EXAMS[canonicalStream(row.stream) ?? ""];
      if (!exam || row.students <= 0) continue;
      const key = `${row.grade}:${exam}`;
      let card = byClass.get(key);
      if (!card) {
        card = {
          centreId: centre.id,
          centreName: centre.name,
          tag: centreTag(centre.type_code),
          grade: row.grade,
          exam,
          levels: [],
          na: 0,
          total: 0,
        };
        byClass.set(key, card);
      }
      card.total += row.students;
      if (row.academicLevel === null) {
        card.na += row.students;
        continue;
      }
      const level = card.levels.find((entry) => entry.level === row.academicLevel);
      if (level) level.students += row.students;
      else card.levels.push({ level: row.academicLevel, students: row.students });
    }
    for (const card of byClass.values()) {
      card.levels.sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.level.localeCompare(b.level));
      cards.push(card);
    }
  });

  cards.sort(
    (a, b) =>
      tagRank(a.tag) - tagRank(b.tag) ||
      a.tag.localeCompare(b.tag) ||
      Number(a.centreId) - Number(b.centreId) ||
      a.grade - b.grade ||
      EXAM_ORDER.indexOf(a.exam) - EXAM_ORDER.indexOf(b.exam)
  );
  return { available: true, cards };
}
