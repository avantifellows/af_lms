import type { PoolClient } from "pg";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";

// Blended Learning Mentee-list fixtures (#442). Every date is a hand-written
// offset in IST calendar days from the seed's IST "today", which is the same
// IST date the app computes while the suite runs. Mentor A is the
// e2e-blended-mentor persona seeded by seedHolisticFixtures (#441).

export const BLENDED_MENTOR_A = {
  name: "Synthetic Blended Mentor",
  email: "e2e-blended-mentor@test.local",
};
export const BLENDED_MENTOR_B = {
  name: "Synthetic Blended Mentor B",
  email: "e2e-blended-mentor-b@test.local",
};

type Grade = 12 | 13;
type FixtureMentee = {
  key: string;
  firstName: string;
  lastName: string;
  gender: "Male" | "Female";
  grade: Grade;
  programId: number;
};

// Mentor A's active current-year Mentees.
export const MENTEES = {
  attemptLatest: { key: "A1", firstName: "Ira", lastName: "Attempt", gender: "Female", grade: 12, programId: 80 },
  neverContacted: { key: "A2", firstName: "Kabir", lastName: "Never", gender: "Male", grade: 13, programId: 90 },
  thirtyDays: { key: "A3", firstName: "Meera", lastName: "Thirty", gender: "Female", grade: 12, programId: 81 },
  legacy: { key: "A4", firstName: "Nikhil", lastName: "Legacy", gender: "Male", grade: 13, programId: 91 },
  twentyNineDays: { key: "A5", firstName: "Zoya", lastName: "TwentyNine", gender: "Female", grade: 12, programId: 79 },
  recent: { key: "A6", firstName: "Rohan", lastName: "Recent", gender: "Male", grade: 12, programId: 82 },
} as const satisfies Record<string, FixtureMentee>;

// Students Mentor A must never see.
export const OTHER_STUDENTS = {
  // Mentor B's; Mentor A's earlier Mapping to her has ended.
  reassignedToB: { key: "B1", firstName: "Sana", lastName: "Reassigned", gender: "Female", grade: 12, programId: 80 },
  mentorB: { key: "B2", firstName: "Tara", lastName: "OtherMentor", gender: "Female", grade: 13, programId: 92 },
  // Mapped to Mentor A in the previous academic year only.
  previousYear: { key: "P1", firstName: "Uday", lastName: "PastYear", gender: "Male", grade: 12, programId: 80 },
} as const satisfies Record<string, FixtureMentee>;

export function fullName(mentee: { firstName: string; lastName: string }): string {
  return `${mentee.firstName} ${mentee.lastName}`;
}

// The legacy month is a fixed past month, so it is always 30+ days ago.
export const LEGACY_MONTH = "2026-06-01";

function previousAcademicYear(year: string): string {
  const [start, end] = year.split("-").map(Number);
  return `${start - 1}-${end - 1}`;
}

const IST_TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;

type Client = Pick<PoolClient, "query">;

async function mentorUserId(client: Client, email: string): Promise<number> {
  const result = await client.query<{ id: string }>(
    `SELECT COALESCE(permission.user_id, account.id) AS id
     FROM user_permission permission
     LEFT JOIN "user" account ON LOWER(account.email) = LOWER(permission.email)
     WHERE LOWER(permission.email) = LOWER($1)
     LIMIT 1`,
    [email]
  );
  if (!result.rows[0]?.id) throw new Error(`Blended Learning fixture Mentor ${email} is missing`);
  return Number(result.rows[0].id);
}

async function seedMentorB(client: Client): Promise<number> {
  const result = await client.query<{ id: string }>(
    `WITH created AS (
       INSERT INTO "user" (email, first_name, last_name, role, inserted_at, updated_at)
       VALUES ($1, 'Synthetic', 'Blended Mentor B', 'blended_mentor', now(), now())
       RETURNING id
     ), permission AS (
       INSERT INTO user_permission
         (email, level, role, program_ids, school_codes, regions, full_name, read_only, user_id, revoked_at)
       SELECT $1, 1, 'blended_mentor', '{}'::int[], NULL, NULL, $2, false, created.id, NULL
       FROM created
     )
     SELECT id FROM created`,
    [BLENDED_MENTOR_B.email, BLENDED_MENTOR_B.name]
  );
  return Number(result.rows[0].id);
}

async function seedStudent(client: Client, mentee: FixtureMentee, index: number): Promise<number> {
  const result = await client.query<{ id: string }>(
    `WITH account AS (
       INSERT INTO "user" (email, first_name, last_name, gender, phone, role, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'student', now(), now())
       RETURNING id
     ), grade_row AS (
       SELECT id FROM grade WHERE number = $6 ORDER BY id LIMIT 1
     ), enrollment AS (
       INSERT INTO enrollment_record (user_id, group_id, group_type, academic_year, is_current, inserted_at, updated_at)
       SELECT account.id, grade_row.id, 'grade', $7, true, now(), now() FROM account, grade_row
     )
     INSERT INTO student (student_id, user_id, grade_id, status, inserted_at, updated_at)
     SELECT $8, account.id, grade_row.id, 'active', now(), now() FROM account, grade_row
     RETURNING id`,
    [
      `e2e-bl-${mentee.key.toLowerCase()}@test.local`,
      mentee.firstName,
      mentee.lastName,
      mentee.gender,
      `98765100${String(index).padStart(2, "0")}`,
      mentee.grade,
      CURRENT_ACADEMIC_YEAR,
      `E2E-BL-${mentee.key}`,
    ]
  );
  return Number(result.rows[0].id);
}

async function seedMapping(
  client: Client,
  mapping: {
    studentId: number;
    mentorUserId: number;
    programId: number;
    academicYear: string;
    startedDaysAgo: number;
    endedDaysAgo?: number;
  }
) {
  await client.query(
    `INSERT INTO blended_learning_mentor_mentee_mappings
       (student_id, mentor_user_id, program_id, academic_year, started_at, assignment_source,
        ended_at, end_source, end_reason)
     VALUES ($1, $2, $3, $4, now() - make_interval(days => $5), 'e2e_fixture',
       CASE WHEN $6::int IS NULL THEN NULL ELSE now() - make_interval(days => $6::int) END,
       CASE WHEN $6::int IS NULL THEN NULL ELSE 'e2e_fixture' END,
       CASE WHEN $6::int IS NULL THEN NULL ELSE 'reassigned' END)`,
    [
      mapping.studentId,
      mapping.mentorUserId,
      mapping.programId,
      mapping.academicYear,
      mapping.startedDaysAgo,
      mapping.endedDaysAgo ?? null,
    ]
  );
}

async function seedEntry(
  client: Client,
  entry: {
    kind: "conversation" | "attempt";
    studentId: number;
    mentorUserId: number;
    programId: number;
    daysAgo: number;
  }
) {
  const conversation = entry.kind === "conversation";
  await client.query(
    `INSERT INTO blended_learning_conversations
       (student_id, program_id, academic_year, mentor_user_id, logged_by_email, kind, occurred_on,
        mode, spoke_with, duration_minutes, summary, attempt_note)
     VALUES ($1, $2, $3, $4, $5, $6, ${IST_TODAY} - $7::int, $8, $9, $10, $11, $12)`,
    [
      entry.studentId,
      entry.programId,
      CURRENT_ACADEMIC_YEAR,
      entry.mentorUserId,
      BLENDED_MENTOR_A.email,
      entry.kind,
      entry.daysAgo,
      conversation ? "call" : null,
      conversation ? "student" : null,
      conversation ? 25 : null,
      conversation ? "Synthetic summary only." : null,
      conversation ? null : "Synthetic: no answer.",
    ]
  );
}

async function seedDraft(
  client: Client,
  draft: { studentId: number; mentorUserId: number; programId: number; state: "ready" | "failed" }
) {
  const ready = draft.state === "ready";
  await client.query(
    `INSERT INTO blended_learning_conversation_drafts
       (student_id, program_id, academic_year, mentor_user_id, created_by_email, state,
        call_recording_s3_key, recording_content_type, recording_byte_size,
        transcript_s3_key, draft_summary, prompt_version, model_id, ready_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'audio/mpeg', 1024, $8, $9, $10, $11,
       CASE WHEN $12 THEN now() ELSE NULL END)`,
    [
      draft.studentId,
      draft.programId,
      CURRENT_ACADEMIC_YEAR,
      draft.mentorUserId,
      BLENDED_MENTOR_A.email,
      draft.state,
      `lms-documents/blended-learning/recordings/${draft.studentId}/00000000-0000-4000-8000-000000000000.mp3`,
      ready ? `lms-documents/blended-learning/transcripts/${draft.studentId}/fixture.json` : null,
      ready ? "Synthetic drafted summary." : null,
      ready ? "fixture-v1" : null,
      ready ? "fixture-model" : null,
      ready,
    ]
  );
}

export async function seedBlendedLearningFixtures(client: Client): Promise<void> {
  const mentorA = await mentorUserId(client, BLENDED_MENTOR_A.email);
  const mentorB = await seedMentorB(client);

  const ids: Record<string, number> = {};
  for (const [index, mentee] of [...Object.values(MENTEES), ...Object.values(OTHER_STUDENTS)].entries()) {
    ids[mentee.key] = await seedStudent(client, mentee, index);
  }

  for (const mentee of Object.values(MENTEES)) {
    await seedMapping(client, {
      studentId: ids[mentee.key],
      mentorUserId: mentorA,
      programId: mentee.programId,
      academicYear: CURRENT_ACADEMIC_YEAR,
      startedDaysAgo: 90,
    });
  }
  const { reassignedToB, mentorB: mentorBStudent, previousYear } = OTHER_STUDENTS;
  await seedMapping(client, {
    studentId: ids[reassignedToB.key],
    mentorUserId: mentorA,
    programId: reassignedToB.programId,
    academicYear: CURRENT_ACADEMIC_YEAR,
    startedDaysAgo: 90,
    endedDaysAgo: 20,
  });
  for (const student of [reassignedToB, mentorBStudent]) {
    await seedMapping(client, {
      studentId: ids[student.key],
      mentorUserId: mentorB,
      programId: student.programId,
      academicYear: CURRENT_ACADEMIC_YEAR,
      startedDaysAgo: 20,
    });
  }
  await seedMapping(client, {
    studentId: ids[previousYear.key],
    mentorUserId: mentorA,
    programId: previousYear.programId,
    academicYear: previousAcademicYear(CURRENT_ACADEMIC_YEAR),
    startedDaysAgo: 400,
  });

  const entry = (key: string, programId: number, kind: "conversation" | "attempt", daysAgo: number) =>
    seedEntry(client, { kind, studentId: ids[key], mentorUserId: mentorA, programId, daysAgo });
  const { attemptLatest, neverContacted, thirtyDays, legacy, twentyNineDays, recent } = MENTEES;
  // Last Contact 10 days ago; the Attempt 2 days ago is the latest entry.
  await entry(attemptLatest.key, attemptLatest.programId, "conversation", 10);
  await entry(attemptLatest.key, attemptLatest.programId, "attempt", 2);
  await entry(thirtyDays.key, thirtyDays.programId, "conversation", 30);
  await entry(twentyNineDays.key, twentyNineDays.programId, "conversation", 29);
  await entry(recent.key, recent.programId, "conversation", 3);

  // A ready draft must not count as contact; a failed one shows no chip.
  await seedDraft(client, {
    studentId: ids[neverContacted.key],
    mentorUserId: mentorA,
    programId: neverContacted.programId,
    state: "ready",
  });
  await seedDraft(client, {
    studentId: ids[recent.key],
    mentorUserId: mentorA,
    programId: recent.programId,
    state: "failed",
  });

  await client.query(
    `INSERT INTO blended_learning_student_links (student_id, profile_doc_url, screener_url, legacy_last_contact_month)
     VALUES
       ($1, 'https://docs.google.com/document/d/e2e-legacy', 'https://forms.gle/e2e-legacy', $4::date),
       ($2, 'https://docs.google.com/document/d/e2e-thirty', NULL, NULL),
       ($3, 'https://docs.google.com/document/d/e2e-recent', 'https://forms.gle/e2e-recent', NULL)`,
    [ids[legacy.key], ids[thirtyDays.key], ids[recent.key], LEGACY_MONTH]
  );
}
