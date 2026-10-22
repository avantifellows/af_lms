import type { PoolClient } from "pg";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";

// Blended Learning Mentee-list (#442), Mentee-detail (#444), logging (#445),
// Action Item (#446), Mentor Flag (#447) and draft review (#451) fixtures.
// Every date is a hand-written offset in IST calendar days from the seed's IST
// "today", which is the same IST date the app computes while the suite runs.
// Mentor A is the e2e-blended-mentor persona seeded by seedHolisticFixtures (#441).

export const BLENDED_MENTOR_A = {
  name: "Synthetic Blended Mentor",
  email: "e2e-blended-mentor@test.local",
};
export const BLENDED_MENTOR_B = {
  name: "Synthetic Blended Mentor B",
  email: "e2e-blended-mentor-b@test.local",
};

// Mentor C's Mentees exist only for the logging spec (#445), which appends
// Conversations and Attempts to them, one set per viewport. Other specs must
// not assert on Mentor C or these Mentees.
export const BLENDED_MENTOR_C = {
  name: "Synthetic Blended Mentor C",
  email: "e2e-blended-mentor-c@test.local",
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

// Mentor C's Mentees for the logging spec (#445), per viewport: one never
// contacted (logs a Conversation), one whose last Conversation was
// LOGGING_LAST_CONVERSATION_DAYS_AGO IST days ago (logs an Attempt), and one
// never contacted that an admin logs for on Mentor C's behalf.
export const LOGGING_MENTEES = {
  desktop: {
    conversation: { key: "C1", firstName: "Charu", lastName: "Desk", gender: "Female", grade: 12, programId: 80 },
    attempt: { key: "C2", firstName: "Arun", lastName: "Desk", gender: "Male", grade: 13, programId: 90 },
    onBehalf: { key: "C3", firstName: "Bela", lastName: "Desk", gender: "Female", grade: 12, programId: 81 },
  },
  mobile: {
    conversation: { key: "C4", firstName: "Charu", lastName: "Mobile", gender: "Female", grade: 12, programId: 80 },
    attempt: { key: "C5", firstName: "Arun", lastName: "Mobile", gender: "Male", grade: 13, programId: 90 },
    onBehalf: { key: "C6", firstName: "Bela", lastName: "Mobile", gender: "Female", grade: 12, programId: 81 },
  },
} as const satisfies Record<string, Record<string, FixtureMentee>>;
export const LOGGING_LAST_CONVERSATION_DAYS_AGO = 5;

// Mentor C's Mentees for the Action Item spec (#446), one per viewport. Each
// has a Conversation ACTION_ITEMS_AGREED_DAYS_AGO IST days ago that agreed
// three Action Items: two still open and one ticked done by a Conversation
// ACTION_ITEMS_DONE_DAYS_AGO days ago.
export const ACTION_ITEM_MENTEES = {
  desktop: { key: "D1", firstName: "Devika", lastName: "Desk", gender: "Female", grade: 12, programId: 80 },
  mobile: { key: "D2", firstName: "Devika", lastName: "Mobile", gender: "Female", grade: 13, programId: 90 },
} as const satisfies Record<string, FixtureMentee>;
export const ACTION_ITEMS_AGREED_DAYS_AGO = 14;
export const ACTION_ITEMS_DONE_DAYS_AGO = 7;
export const EARLIER_ACTION_ITEMS = {
  // Open, owned by the Student, due 7 IST days after the seed's today.
  toTick: { text: "Synthetic: finish the optics DPP", owner: "student", dueInDays: 7 },
  // Open, owned by the Parent, no due date.
  stayOpen: { text: "Synthetic: confirm the hostel fee date", owner: "parent" },
  // Done by the later Conversation.
  done: { text: "Synthetic: share the mock test schedule", owner: "mentor" },
} as const;
// Mentor C's Mentees for the Mentor Flag spec (#447), one per viewport, never
// contacted. The spec appends flagged Conversations to them.
export const FLAG_MENTEES = {
  desktop: { key: "E1", firstName: "Esha", lastName: "Desk", gender: "Female", grade: 12, programId: 80 },
  mobile: { key: "E2", firstName: "Esha", lastName: "Mobile", gender: "Female", grade: 13, programId: 90 },
} as const satisfies Record<string, FixtureMentee>;
// Mentor C's Mentees for the draft review spec (#451), one per viewport, never
// contacted. The spec gives each a ready Conversation Draft and saves it.
export const DRAFT_REVIEW_MENTEES = {
  desktop: { key: "F1", firstName: "Farah", lastName: "Desk", gender: "Female", grade: 12, programId: 80 },
  mobile: { key: "F2", firstName: "Farah", lastName: "Mobile", gender: "Female", grade: 13, programId: 90 },
} as const satisfies Record<string, FixtureMentee>;
export const LOGGING_LAST_CONVERSATION_SUMMARY = "Synthetic: planned the week's revision.";

// Contact numbers on the `user` row (#444). Phones are 98765100 + the
// Student's seed index. Ira's WhatsApp differs and her parents' phones are
// seeded only to prove they are never shown; Rohan's WhatsApp equals his phone.
export const CONTACTS = {
  attemptLatest: { phone: "9876510000", whatsapp: "9123400001", fatherPhone: "9000000001", guardianPhone: "9000000002" },
  recent: { phone: "9876510005", whatsapp: "9876510005" },
} as const;

// Ira's history (#444), newest first by (occurred_on, id). The Attempt 10 days
// ago is inserted after the Conversation that day, so it sorts above it.
export const IRA_HISTORY = {
  attempt2: { daysAgo: 2, note: "Synthetic: no answer." },
  attempt10: { daysAgo: 10, note: "Synthetic: phone switched off." },
  conversation10: { daysAgo: 10, summary: "Synthetic: followed up on the mock test." },
  conversation20: {
    daysAgo: 20,
    summary: "Synthetic: talked through the JEE study plan.",
    notesText: "Synthetic: revise optics before Friday",
    actionItems: {
      done: "Synthetic: share the mock test schedule",
      open: "Synthetic: call the parent about hostel fees",
    },
    flags: {
      wellbeing: "Synthetic: seemed anxious before the mock test",
    },
    photoCount: 2,
  },
} as const;

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

async function seedMentor(client: Client, mentor: { name: string; email: string }): Promise<number> {
  const result = await client.query<{ id: string }>(
    `WITH created AS (
       INSERT INTO "user" (email, first_name, last_name, role, inserted_at, updated_at)
       VALUES ($1, 'Synthetic', $3, 'blended_mentor', now(), now())
       RETURNING id
     ), permission AS (
       INSERT INTO user_permission
         (email, level, role, program_ids, school_codes, regions, full_name, read_only, user_id, revoked_at)
       SELECT $1, 1, 'blended_mentor', '{}'::int[], NULL, NULL, $2, false, created.id, NULL
       FROM created
     )
     SELECT id FROM created`,
    [mentor.email, mentor.name, mentor.name.replace(/^Synthetic /, "")]
  );
  return Number(result.rows[0].id);
}

type FixtureContact = { whatsapp?: string; fatherPhone?: string; guardianPhone?: string };

async function seedStudent(
  client: Client,
  mentee: FixtureMentee,
  index: number,
  contact: FixtureContact = {}
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `WITH account AS (
       INSERT INTO "user" (email, first_name, last_name, gender, phone, whatsapp_phone, role, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $9, 'student', now(), now())
       RETURNING id
     ), grade_row AS (
       SELECT id FROM grade WHERE number = $6 ORDER BY id LIMIT 1
     ), enrollment AS (
       INSERT INTO enrollment_record (user_id, group_id, group_type, academic_year, is_current, inserted_at, updated_at)
       SELECT account.id, grade_row.id, 'grade', $7, true, now(), now() FROM account, grade_row
     )
     INSERT INTO student (student_id, user_id, grade_id, status, father_phone, guardian_phone, inserted_at, updated_at)
     SELECT $8, account.id, grade_row.id, 'active', $10, $11, now(), now() FROM account, grade_row
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
      contact.whatsapp ?? null,
      contact.fatherPhone ?? null,
      contact.guardianPhone ?? null,
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
    summary?: string;
    note?: string;
    mode?: "call" | "in_person";
    spokeWith?: "student" | "parent_or_sibling" | "both";
    durationMinutes?: number;
    notesHtml?: string;
  }
): Promise<number> {
  const conversation = entry.kind === "conversation";
  const result = await client.query<{ id: string }>(
    `INSERT INTO blended_learning_conversations
       (student_id, program_id, academic_year, mentor_user_id, logged_by_email, kind, occurred_on,
        mode, spoke_with, duration_minutes, summary, attempt_note, notes_html)
     VALUES ($1, $2, $3, $4, $5, $6, ${IST_TODAY} - $7::int, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      entry.studentId,
      entry.programId,
      CURRENT_ACADEMIC_YEAR,
      entry.mentorUserId,
      BLENDED_MENTOR_A.email,
      entry.kind,
      entry.daysAgo,
      conversation ? entry.mode ?? "call" : null,
      conversation ? entry.spokeWith ?? "student" : null,
      conversation ? entry.durationMinutes ?? 25 : null,
      conversation ? entry.summary ?? "Synthetic summary only." : null,
      conversation ? null : entry.note ?? "Synthetic: no answer.",
      entry.notesHtml ?? null,
    ]
  );
  return Number(result.rows[0].id);
}

// Ira's older Conversation (#444): Action Items (one ticked done by the
// Conversation 10 days ago), two Mentor Flags and two photo rows. Photos are
// rows only; no object exists in S3.
async function seedIraAttachments(
  client: Client,
  ids: { studentId: number; conversation20: number; conversation10: number }
) {
  const { actionItems, flags, photoCount } = IRA_HISTORY.conversation20;
  await client.query(
    `INSERT INTO blended_learning_action_items
       (conversation_id, student_id, position, text, owner, status,
        completed_by_conversation_id, completed_at, completed_by_email)
     VALUES
       ($1, $2, 1, $3, 'mentor', 'done', $4, now(), $6),
       ($1, $2, 2, $5, 'mentor', 'open', NULL, NULL, NULL)`,
    [ids.conversation20, ids.studentId, actionItems.done, ids.conversation10, actionItems.open, BLENDED_MENTOR_A.email]
  );
  await client.query(
    `INSERT INTO blended_learning_mentor_flags (conversation_id, student_id, recipient, comment, raised_by_email)
     VALUES ($1, $2, 'emotional_wellbeing', $3, $4), ($1, $2, 'physics', NULL, $4)`,
    [ids.conversation20, ids.studentId, flags.wellbeing, BLENDED_MENTOR_A.email]
  );
  for (let position = 1; position <= photoCount; position++) {
    await client.query(
      `INSERT INTO blended_learning_conversation_photos (conversation_id, s3_key, content_type, byte_size, position)
       VALUES ($1, $2, 'image/jpeg', 1024, $3)`,
      [ids.conversation20, `lms-documents/blended-learning/photos/${ids.studentId}/fixture-${position}.jpg`, position]
    );
  }
}

// A Conversation that agreed EARLIER_ACTION_ITEMS, and the later one that
// ticked `done`. Rows are inserted in final form (they are append-only).
async function seedEarlierActionItems(
  client: Client,
  mentee: { studentId: number; mentorUserId: number; programId: number }
) {
  const agreedId = await seedEntry(client, {
    ...mentee,
    kind: "conversation",
    daysAgo: ACTION_ITEMS_AGREED_DAYS_AGO,
    summary: "Synthetic: agreed the revision plan.",
  });
  const doneById = await seedEntry(client, {
    ...mentee,
    kind: "conversation",
    daysAgo: ACTION_ITEMS_DONE_DAYS_AGO,
    summary: "Synthetic: checked in on the plan.",
  });
  const { toTick, stayOpen, done } = EARLIER_ACTION_ITEMS;
  await client.query(
    `INSERT INTO blended_learning_action_items
       (conversation_id, student_id, position, text, owner, due_on, status,
        completed_by_conversation_id, completed_at, completed_by_email)
     VALUES
       ($1, $2, 1, $3, $4, ${IST_TODAY} + $5::int, 'open', NULL, NULL, NULL),
       ($1, $2, 2, $6, $7, NULL, 'open', NULL, NULL, NULL),
       ($1, $2, 3, $8, $9, NULL, 'done', $10, now(), $11)`,
    [
      agreedId,
      mentee.studentId,
      toTick.text,
      toTick.owner,
      toTick.dueInDays,
      stayOpen.text,
      stayOpen.owner,
      done.text,
      done.owner,
      doneById,
      BLENDED_MENTOR_C.email,
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
  const mentorB = await seedMentor(client, BLENDED_MENTOR_B);
  const mentorC = await seedMentor(client, BLENDED_MENTOR_C);

  const ids: Record<string, number> = {};
  const contacts: Record<string, FixtureContact> = {
    [MENTEES.attemptLatest.key]: CONTACTS.attemptLatest,
    [MENTEES.recent.key]: CONTACTS.recent,
  };
  const loggingMentees = [
    ...Object.values(LOGGING_MENTEES).flatMap((set) => Object.values(set)),
    ...Object.values(ACTION_ITEM_MENTEES),
    ...Object.values(FLAG_MENTEES),
    ...Object.values(DRAFT_REVIEW_MENTEES),
  ];
  for (const [index, mentee] of [
    ...Object.values(MENTEES),
    ...Object.values(OTHER_STUDENTS),
    ...loggingMentees,
  ].entries()) {
    ids[mentee.key] = await seedStudent(client, mentee, index, contacts[mentee.key]);
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

  for (const mentee of loggingMentees) {
    await seedMapping(client, {
      studentId: ids[mentee.key],
      mentorUserId: mentorC,
      programId: mentee.programId,
      academicYear: CURRENT_ACADEMIC_YEAR,
      startedDaysAgo: 90,
    });
  }
  for (const { attempt } of Object.values(LOGGING_MENTEES)) {
    await seedEntry(client, {
      kind: "conversation",
      studentId: ids[attempt.key],
      mentorUserId: mentorC,
      programId: attempt.programId,
      daysAgo: LOGGING_LAST_CONVERSATION_DAYS_AGO,
      summary: LOGGING_LAST_CONVERSATION_SUMMARY,
    });
  }

  for (const mentee of Object.values(ACTION_ITEM_MENTEES)) {
    await seedEarlierActionItems(client, {
      studentId: ids[mentee.key],
      mentorUserId: mentorC,
      programId: mentee.programId,
    });
  }

  const entry = (key: string, programId: number, kind: "conversation" | "attempt", daysAgo: number) =>
    seedEntry(client, { kind, studentId: ids[key], mentorUserId: mentorA, programId, daysAgo });
  const { attemptLatest, neverContacted, thirtyDays, legacy, twentyNineDays, recent } = MENTEES;
  // Last Contact 10 days ago; the Attempt 2 days ago is the latest entry.
  const ira = { studentId: ids[attemptLatest.key], mentorUserId: mentorA, programId: attemptLatest.programId };
  const { conversation20, conversation10, attempt10, attempt2 } = IRA_HISTORY;
  const conversation20Id = await seedEntry(client, {
    ...ira,
    kind: "conversation",
    daysAgo: conversation20.daysAgo,
    summary: conversation20.summary,
    mode: "in_person",
    spokeWith: "parent_or_sibling",
    durationMinutes: 40,
    notesHtml: `<h3>Study plan</h3><ul><li>${conversation20.notesText}</li></ul>`,
  });
  const conversation10Id = await seedEntry(client, {
    ...ira,
    kind: "conversation",
    daysAgo: conversation10.daysAgo,
    summary: conversation10.summary,
  });
  await seedEntry(client, { ...ira, kind: "attempt", daysAgo: attempt10.daysAgo, note: attempt10.note });
  await seedEntry(client, { ...ira, kind: "attempt", daysAgo: attempt2.daysAgo, note: attempt2.note });
  await seedIraAttachments(client, {
    studentId: ira.studentId,
    conversation20: conversation20Id,
    conversation10: conversation10Id,
  });
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
