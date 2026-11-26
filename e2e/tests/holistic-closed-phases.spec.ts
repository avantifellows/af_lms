import { expect, test } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

// Issue #536: once a later Phase of a Grade is Open, the earlier one is Closed.
// The fixture Plan has "Synthetic Grade 11 Completed" (Phase 1) and "Synthetic
// Grade 11 Active" (Phase 2) both Open, so Phase 1 is Closed, and it holds the
// fixture Teacher's own submitted Notes. Nothing here changes fixture rows:
// every write is one the server must refuse, and the Open Phase dialog is dismissed.
// One test opens the Locked Grade 11 Phase by SQL for a moment and puts it back.

const CLOSED_ERROR = "This Phase is closed. Notes can be added or changed only in the Active Phase.";

type Fixture = {
  schoolCode: string;
  studentId: number;
  mappingId: number;
  closedPhaseId: number;
  closedPhaseRevision: number;
  notesRevision: number;
  questionIds: number[];
};

let fixture: Fixture;

async function closedPhaseNotes() {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ state: string; revision: number; answers: string; follow_ups: string }>(
      `SELECT notes.state, notes.revision,
              (SELECT COALESCE(string_agg(answer.answer, ' | ' ORDER BY answer.question_id), '')
               FROM holistic_mentorship_post_session_answers answer WHERE answer.notes_id = notes.id) AS answers,
              (SELECT COUNT(*) FROM holistic_mentorship_follow_up_notes follow_up
               WHERE follow_up.student_id = notes.student_id AND follow_up.phase_id = notes.phase_id) AS follow_ups
       FROM holistic_mentorship_post_session_notes notes
       WHERE notes.student_id = $1 AND notes.phase_id = $2`,
      [fixture.studentId, fixture.closedPhaseId]
    );
    return result.rows[0];
  } finally {
    await pool.end();
  }
}

function query() {
  return `school_code=${fixture.schoolCode}&program_id=1&academic_year=2026-2027`;
}

type Pool = ReturnType<typeof getTestPool>;

// A Mentee of the fixture Teacher with no submitted Notes in Grade 11's Active
// Phase (so the form is shown), and Grade 11's next, still Locked, Phase.
async function activeFormMentee(pool: Pool) {
  const result = await pool.query<{ student_id: string; active_id: string; locked_id: string; school_code: string }>(
    `WITH grade11 AS (
       SELECT phase.id, phase.state, phase.position
       FROM holistic_mentorship_phases phase
       JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
         AND plan.program_id = 1 AND plan.academic_year = '2026-2027'
       JOIN grade ON grade.id = phase.grade_id AND grade.number = 11
     )
     SELECT mapping.student_id, school.code AS school_code,
            (SELECT id FROM grade11 WHERE state = 'open' ORDER BY position DESC LIMIT 1) AS active_id,
            (SELECT id FROM grade11 WHERE state = 'locked' ORDER BY position LIMIT 1) AS locked_id
     FROM holistic_mentorship_mentor_mentee_mappings mapping
     JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
       AND LOWER(mentor.email) = 'e2e-holistic-teacher@test.local'
     JOIN school ON school.id = mapping.school_id
     JOIN holistic_mentorship_post_session_notes earlier ON earlier.student_id = mapping.student_id
       AND earlier.phase_id = $1
     WHERE mapping.program_id = 1 AND mapping.academic_year = '2026-2027' AND mapping.ended_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM holistic_mentorship_post_session_notes notes
         WHERE notes.student_id = mapping.student_id AND notes.state = 'submitted'
           AND notes.phase_id = (SELECT id FROM grade11 WHERE state = 'open' ORDER BY position DESC LIMIT 1))
     ORDER BY mapping.student_id LIMIT 1`,
    [fixture.closedPhaseId]
  );
  const row = result.rows[0];
  expect(row, "the fixture needs a Grade 11 Mentee without submitted Notes in the Active Phase").toBeTruthy();
  return {
    ...row,
    lockedPhaseId: Number(row.locked_id),
    url: `/holistic-mentorship/students/${row.student_id}/phases/${row.active_id}`
      + `?school_code=${row.school_code}&program_id=1&academic_year=2026-2027`,
  };
}

async function notesAnswers(pool: Pool, studentId: string, phaseId: string) {
  const result = await pool.query(
    `SELECT answer.answer FROM holistic_mentorship_post_session_answers answer
     JOIN holistic_mentorship_post_session_notes notes ON notes.id = answer.notes_id
     WHERE notes.student_id = $1 AND notes.phase_id = $2 ORDER BY answer.question_id`,
    [studentId, phaseId]);
  return result.rows;
}

async function teacherDictationRecords() {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM holistic_mentorship_dictation_usage_records record
       JOIN "user" mentor ON mentor.id = record.mentor_user_id
       WHERE LOWER(mentor.email) = 'e2e-holistic-teacher@test.local'`);
    return Number(result.rows[0].count);
  } finally {
    await pool.end();
  }
}

// Chromium's fake device needs a launch flag; a Web Audio tone stands in for
// the microphone instead (as in holistic-mentorship.spec.ts).
function installWebAudioMicrophone() {
  navigator.mediaDevices.getUserMedia = async () => {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const microphone = audio.createMediaStreamDestination();
    tone.connect(microphone);
    tone.start();
    return microphone.stream;
  };
}

test.describe("Closed Holistic Phases", () => {
  test.beforeAll(async () => {
    const pool = getTestPool();
    try {
      // The fixture Teacher's own submitted Notes on a Grade 11 Phase that a
      // later Open Grade 11 Phase has closed.
      const result = await pool.query<{
        school_code: string; student_id: string; mapping_id: string; phase_id: string;
        phase_revision: number; notes_revision: number; question_ids: string[];
      }>(
        `SELECT school.code AS school_code, notes.student_id, mapping.id AS mapping_id,
                phase.id AS phase_id, phase.revision AS phase_revision, notes.revision AS notes_revision,
                ARRAY(SELECT question.id::text FROM holistic_mentorship_phase_questions question
                      WHERE question.phase_id = phase.id ORDER BY question.position) AS question_ids
         FROM holistic_mentorship_post_session_notes notes
         JOIN holistic_mentorship_phases phase ON phase.id = notes.phase_id AND phase.state = 'open'
         JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
           AND plan.program_id = 1 AND plan.academic_year = '2026-2027'
         JOIN grade ON grade.id = phase.grade_id AND grade.number = 11
         JOIN holistic_mentorship_mentor_mentee_mappings mapping ON mapping.student_id = notes.student_id
           AND mapping.program_id = 1 AND mapping.academic_year = '2026-2027' AND mapping.ended_at IS NULL
           AND mapping.mentor_user_id = notes.author_user_id
         JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
           AND LOWER(mentor.email) = 'e2e-holistic-teacher@test.local'
         JOIN school ON school.id = mapping.school_id
         WHERE notes.state = 'submitted'
           AND EXISTS (SELECT 1 FROM holistic_mentorship_phases later
                       WHERE later.phase_plan_id = phase.phase_plan_id AND later.grade_id = phase.grade_id
                         AND later.state = 'open' AND later.position > phase.position)
         ORDER BY notes.student_id LIMIT 1`
      );
      const row = result.rows[0];
      expect(row, "the fixture needs the Teacher's submitted Notes on a Closed Grade 11 Phase").toBeTruthy();
      fixture = {
        schoolCode: row.school_code,
        studentId: Number(row.student_id),
        mappingId: Number(row.mapping_id),
        closedPhaseId: Number(row.phase_id),
        closedPhaseRevision: row.phase_revision,
        notesRevision: row.notes_revision,
        questionIds: row.question_ids.map(Number),
      };
    } finally {
      await pool.end();
    }
  });

  test("a Mentor reads a Closed Phase but cannot change it, on screen or through the API", async ({
    holisticTeacherPage: page,
  }) => {
    const before = await closedPhaseNotes();
    const phasePath = `/holistic-mentorship/students/${fixture.studentId}/phases/${fixture.closedPhaseId}`;

    await page.goto(`${phasePath}?${query()}`);

    // Readable, with the closed notice and no way to edit or add.
    await expect(page.getByRole("note")).toContainText("This Phase is closed.");
    await expect(page.getByRole("heading", { name: "Post-Session Notes" })).toBeVisible();
    await expect(page.getByText(/Submitted by .+ on/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Notes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit Notes" })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    // Dictation is on in e2e, but a Closed Phase offers no mic anywhere.
    await expect(page.getByRole("button", { name: /^Dictate/ })).toHaveCount(0);
    const addFollowUp = page.getByRole("region", { name: "Follow-up Notes" })
      .getByRole("button", { name: "Add notes" });
    await expect(addFollowUp).toBeDisabled();
    await expect(addFollowUp).toHaveAccessibleDescription("This Phase is closed");
    // The Grade's Active Phase is still offered as Open or Completed, never Closed.
    await expect(page.getByRole("tab", { name: /Synthetic Grade 11 Active - (Open|Completed)$/ })).toBeVisible();

    // The API refuses the same writes when called directly.
    const notesBody = (action: "draft" | "edit") => ({
      action,
      expected_revision: fixture.notesRevision,
      expected_mapping_id: fixture.mappingId,
      expected_phase_revision: fixture.closedPhaseRevision,
      confirmed: true,
      answers: fixture.questionIds.map((question_id) => ({ question_id, answer: "Changed after the Phase closed" })),
      challenge_categories: ["academic.exam_related", "non_academic.time_management"],
    });
    for (const action of ["edit", "draft"] as const) {
      const response = await page.request.patch(`/api${phasePath}?${query()}`, { data: notesBody(action) });
      expect(response.status(), action).toBe(422);
      expect(await response.json(), action).toMatchObject({ error: CLOSED_ERROR });
    }
    const followUp = await page.request.post(`/api${phasePath}/follow-up-notes?${query()}`, {
      data: { answers: { challenges: "Added after the Phase closed", solutions: "", action_plan: "" } },
    });
    expect(followUp.status()).toBe(422);
    expect(await followUp.json()).toMatchObject({ error: CLOSED_ERROR });
    // Dictation goes through the same write check: refused before any provider
    // call, so no usage record is written.
    const recordsBefore = await teacherDictationRecords();
    for (const kind of ["post_session", "follow_up"]) {
      const dictation = await page.request.post(`/api${phasePath}/dictation?${query()}`, {
        multipart: {
          audio: { name: "dictation.webm", mimeType: "audio/webm", buffer: Buffer.from("spoken clip") },
          kind,
          duration_ms: "2000",
        },
      });
      expect(dictation.status(), kind).toBe(422);
      expect(await dictation.json(), kind).toEqual({ error: CLOSED_ERROR });
    }
    expect(await teacherDictationRecords()).toBe(recordsBefore);

    expect(await closedPhaseNotes()).toEqual(before);
  });

  test("a Mentor whose form was open when the Phase closed is told so, keeps their text on screen, and can leave", async ({
    holisticTeacherPage: page,
  }) => {
    const pool = getTestPool();
    let lockedPhaseId = 0;
    try {
      const row = await activeFormMentee(pool);
      lockedPhaseId = row.lockedPhaseId;
      const answersBefore = await notesAnswers(pool, row.student_id, row.active_id);

      await page.goto(row.url);
      const answer = page.getByRole("textbox").first();
      await expect(answer).toBeVisible();
      await expect(page.getByRole("button", { name: /^Dictate/ }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");

      // An Admin opens Grade 11's next Phase: this one stops being the Active Phase.
      await pool.query(`UPDATE holistic_mentorship_phases SET state = 'open' WHERE id = $1`, [lockedPhaseId]);
      const refused = page.waitForResponse((response) =>
        response.request().method() === "PATCH" && response.url().includes(`/phases/${row.active_id}`));
      await answer.click();
      await answer.pressSequentially(" typed after the Phase closed", { delay: 10 });
      expect((await refused).status()).toBe(422);

      await expect(page.getByRole("alert").filter({ hasText: "This Phase was closed while you were writing." }))
        .toContainText("Nothing more can be saved or submitted here. Copy anything you need from below, then open the current Phase.");
      // What they typed is still readable, the form is gone, and nothing offers to save again.
      await expect(page.getByText(/typed after the Phase closed/)).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Submit Notes" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Dictate/ })).toHaveCount(0);
      // The rest of the page catches up by itself, with no reload: this Phase's tab
      // now reads Closed, and the typed text is still on screen.
      await expect(page.getByRole("tab", { name: /Synthetic Grade 11 Active/ })).toContainText("Closed");
      await expect(page.getByText(/typed after the Phase closed/)).toBeVisible();

      // They can leave: the earlier Phase's tab opens.
      await page.getByRole("tab", { name: /Synthetic Grade 11 Completed/ }).click();
      await expect(page).toHaveURL(new RegExp(`/phases/${fixture.closedPhaseId}\\b`));

      expect(await notesAnswers(pool, row.student_id, row.active_id)).toEqual(answersBefore);
    } finally {
      if (lockedPhaseId) {
        await pool.query(`UPDATE holistic_mentorship_phases SET state = 'locked' WHERE id = $1`, [lockedPhaseId]);
      }
      await pool.end();
    }
  });

  // #536 with Dictation (#500): the Phase closes before any save notices, and the
  // Mentor's next clip is the first write. The real recorder and route are used;
  // the route's write check refuses the clip, and the form freezes as after a save.
  test("a Mentor who dictates after the Phase closed is told so, and nothing is saved or counted", async ({
    holisticTeacherPage: page,
  }) => {
    const pool = getTestPool();
    let lockedPhaseId = 0;
    try {
      const row = await activeFormMentee(pool);
      lockedPhaseId = row.lockedPhaseId;
      const answersBefore = await notesAnswers(pool, row.student_id, row.active_id);
      const recordsBefore = await teacherDictationRecords();
      await page.addInitScript(installWebAudioMicrophone);
      // Passed on unchanged, so the real route answers.
      await page.route("**/dictation?**", (route) => route.continue());

      await page.goto(row.url);
      const answer = page.getByRole("textbox").first();
      await expect(answer).toBeVisible();
      await page.waitForLoadState("networkidle");
      const shown = await answer.inputValue();

      // Nothing is typed (that would autosave, and the save would find the Phase closed first).
      await pool.query(`UPDATE holistic_mentorship_phases SET state = 'open' WHERE id = $1`, [lockedPhaseId]);
      const mic = page.getByRole("button", { name: /^Dictate/ }).first();
      await mic.click();
      await expect(page.getByText("Recording 0:01", { exact: true })).toBeVisible();
      const refused = page.waitForResponse((response) => response.url().includes("/dictation?"));
      await mic.click();
      const reply = await refused;
      expect(reply.status()).toBe(422);
      expect(await reply.json()).toEqual({ error: CLOSED_ERROR });

      await expect(page.getByRole("alert").filter({ hasText: "This Phase was closed while you were writing." }))
        .toContainText("Nothing more can be saved or submitted here.");
      if (shown.trim()) await expect(page.getByText(shown.trim(), { exact: false }).first()).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Dictate/ })).toHaveCount(0);
      await expect(page.getByText("Couldn't send that recording. Reload the page and try again.")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: /Synthetic Grade 11 Active/ })).toContainText("Closed");

      expect(await teacherDictationRecords()).toBe(recordsBefore);
      expect(await notesAnswers(pool, row.student_id, row.active_id)).toEqual(answersBefore);
    } finally {
      if (lockedPhaseId) {
        await pool.query(`UPDATE holistic_mentorship_phases SET state = 'locked' WHERE id = $1`, [lockedPhaseId]);
      }
      await pool.end();
    }
  });

  test("Phase Setup shows the earlier Phase as Closed and warns before opening the next one", async ({
    holisticAdminPage: page,
  }) => {
    await page.goto("/admin/holistic-mentorship");
    await page.getByRole("tab", { name: "Phase Setup" }).click();

    const closedPhase = page.getByRole("button", { name: /Synthetic Grade 11 Completed/ });
    await expect(closedPhase).toContainText("Closed");
    await expect(page.getByRole("button", { name: /Synthetic Grade 11 Active/ })).toContainText("Active");
    await closedPhase.click();
    await expect(page.getByText("Closed for Mentors.")).toBeVisible();

    // Opening Grade 11's next Phase would close "Synthetic Grade 11 Active" (Phase 2).
    await page.getByRole("button", { name: /Synthetic Grade 11 Locked/ }).click();
    const impact = page.waitForResponse((response) => response.url().includes("open_impact_phase_id="));
    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Open Phase" }).click();
    const counts = (await (await impact).json()) as {
      impact: { closing: { number: number; menteesWithoutNotes: number; unsubmittedDrafts: number } };
    };
    await expect.poll(() => message).toContain("Open Phase 3?");

    expect(counts.impact.closing.number).toBe(2);
    expect(message).toContain(
      "Phase 2 will close for Grade 11. Mentors will still be able to read its Notes, but not add or change them."
    );
    // The count the Admin reads is the one the server returned.
    const { menteesWithoutNotes } = counts.impact.closing;
    expect(menteesWithoutNotes).toBeGreaterThan(0);
    expect(message).toContain(menteesWithoutNotes === 1
      ? "1 assigned Mentee has no submitted Notes in Phase 2"
      : `${menteesWithoutNotes} assigned Mentees have no submitted Notes in Phase 2`);

    // Dismissed, so nothing changed.
    await expect(page.getByRole("button", { name: "Open Phase" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Synthetic Grade 11 Locked/ })).toContainText("Locked");
  });

  test("Students & Progress reports the earlier Phase as Closed and the latest as Active", async ({
    holisticAdminPage: page,
  }) => {
    const states = async (phaseId?: number) => {
      const response = await page.request.get(
        `/api/holistic-mentorship/progress?program_id=1&academic_year=2026-2027&grade=11` +
          (phaseId ? `&phase_id=${phaseId}` : "")
      );
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { rows: Array<{ phaseState: string | null }> };
      expect(body.rows.length).toBeGreaterThan(0);
      return [...new Set(body.rows.map((row) => row.phaseState))];
    };

    expect(await states(fixture.closedPhaseId)).toEqual(["closed"]);
    expect(await states()).toEqual(["active"]);
  });
});
