import { expect, test } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

// Issue #536: once a later Phase of a Grade is Open, the earlier one is Closed.
// The fixture Plan has "Synthetic Grade 11 Completed" (Phase 1) and "Synthetic
// Grade 11 Active" (Phase 2) both Open, so Phase 1 is Closed, and it holds the
// fixture Teacher's own submitted Notes. Nothing here changes fixture rows:
// every write is one the server must refuse, and the Open Phase dialog is dismissed.

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

    expect(await closedPhaseNotes()).toEqual(before);
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
