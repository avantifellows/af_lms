import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_C,
  JEE_EXISTING_RECORD,
  JEE_FORM_MENTEES,
  JEE_REMINDER_TEXT,
  fullName,
} from "../helpers/blended-learning-fixtures";

// The JEE form card on a Mentee's page, against the real fixture DDL and the
// e2e DB Service stub (e2e/helpers/db-service-stub.mjs), which writes
// student_exam_record the way the DB Service does. Mentor C's JEE form
// Mentees exist only for this spec; the tests build on each other, so they
// run in order. E2E has no S3, so the confirmation PDF upload is covered by
// the route tests; here only its control is checked.
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const STUB = "http://localhost:3902";
const CARD = "JEE Main 2027 form";
const STATUS_QUESTION = "Has the student filled the form?";
const REASONS = "Why hasn't it been filled?";

const studentIds: Record<string, number> = {};

type StubRequest = { method: string; path: string; body: Record<string, unknown> | null };

async function withPool<T>(fn: (pool: ReturnType<typeof getTestPool>) => Promise<T>): Promise<T> {
  const pool = getTestPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

test.beforeAll(async () => {
  await withPool(async (pool) => {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id LIKE 'E2E-BL-K%'`
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
  });
  await fetch(`${STUB}/__requests`, { method: "DELETE" });
});

async function stubRequests(): Promise<StubRequest[]> {
  return (await fetch(`${STUB}/__requests`)).json();
}

function detailPath(mentee: { key: string }) {
  return `/blended-learning/students/${studentIds[mentee.key]}`;
}

function jeeFormUrl(mentee: { key: string }) {
  return `/api/blended-learning/students/${studentIds[mentee.key]}/jee-form`;
}

function card(page: Page): Locator {
  return page.getByRole("region", { name: CARD });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function updates(studentId: number) {
  return withPool(async (pool) => {
    const result = await pool.query<{
      status: string;
      application_number: string | null;
      reasons: string[] | null;
      details: string | null;
      mentor_email: string;
      recorded_by_email: string;
      flag_comment: string | null;
    }>(
      `SELECT u.status, u.application_number, u.reasons, u.details, mentor.email AS mentor_email,
              u.recorded_by_email, flag.comment AS flag_comment
       FROM blended_learning_jee_form_updates u
       JOIN "user" mentor ON mentor.id = u.mentor_user_id
       LEFT JOIN blended_learning_mentor_flags flag ON flag.jee_form_update_id = u.id AND flag.recipient = 'jee_form'
       WHERE u.student_id = $1
       ORDER BY u.id`,
      [studentId]
    );
    return result.rows;
  });
}

// The Student's JEE Mains records. The password is compared in SQL, never read.
async function jeeRecords(studentId: number, password: string | null = null) {
  return withPool(async (pool) => {
    const result = await pool.query<{ id: string; exam_year: number | null; application_number: string; password_kept: boolean }>(
      `SELECT ser.id, ser.exam_year, ser.application_number,
              ser.application_password IS NOT DISTINCT FROM $2::varchar AS password_kept
       FROM student_exam_record ser JOIN exam ON exam.id = ser.exam_id
       WHERE ser.student_id = $1 AND exam.name = 'JEE Mains'
       ORDER BY ser.id`,
      [studentId, password]
    );
    return result.rows;
  });
}

async function reminder(studentId: number) {
  return withPool(async (pool) => {
    const result = await pool.query<{ status: string; ticked_by_jee_form: boolean; completed_by_email: string | null }>(
      `SELECT status, completed_by_jee_form_update_id IS NOT NULL AS ticked_by_jee_form, completed_by_email
       FROM blended_learning_action_items WHERE student_id = $1 AND text = $2`,
      [studentId, JEE_REMINDER_TEXT]
    );
    return result.rows;
  });
}

test.describe("Blended Learning JEE form card — Mentor, desktop", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 800 } });
  const mentee = JEE_FORM_MENTEES.mentor;

  test("shows Not recorded yet and the two choices, with the reminder open and no password field", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(detailPath(mentee));

    const jee = card(page);
    await expect(jee.getByText("Not recorded yet")).toBeVisible();
    const choice = jee.getByRole("group", { name: STATUS_QUESTION });
    await expect(choice.getByRole("radio")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Open Action Items" })).toContainText(JEE_REMINDER_TEXT);
    await jee.getByRole("radio", { name: "Filled", exact: true }).check();
    await expect(jee.getByLabel("Application number")).toBeVisible();
    await expect(jee.getByLabel(/Confirmation page/)).toHaveAttribute("type", "file");
    await expect(jee.getByText(/password/i)).toHaveCount(0);
    await expect(jee.getByLabel(/password/i)).toHaveCount(0);
  });

  test("Not filled needs a reason, and details for Other; saving flags the program team", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(detailPath(mentee));
    const jee = card(page);
    await jee.getByRole("radio", { name: "Not filled", exact: true }).check();
    const reasons = jee.getByRole("group", { name: REASONS });
    await expect(reasons.getByRole("checkbox")).toHaveCount(11);

    await jee.getByRole("button", { name: "Save" }).click();
    await expect(jee.getByText("Choose at least one reason.")).toBeVisible();
    await reasons.getByRole("checkbox", { name: "Not aware about the exam" }).check();
    await reasons.getByRole("checkbox", { name: "Other" }).check();
    await jee.getByRole("button", { name: "Save" }).click();
    await expect(jee.getByText("Describe the other reason.")).toBeVisible();
    await jee.getByLabel("Details", { exact: true }).fill("Synthetic: family is moving this month.");
    await jee.getByRole("button", { name: "Save" }).click();

    await expect(jee.getByText("Flagged to the program team")).toBeVisible();
    await expect(jee.getByRole("list", { name: "Reasons" }).getByRole("listitem")).toHaveText([
      "Not aware about the exam",
      "Other",
    ]);
    expect(await updates(studentIds[mentee.key])).toEqual([
      {
        status: "not_filled",
        application_number: null,
        reasons: ["not_aware", "other"],
        details: "Synthetic: family is moving this month.",
        mentor_email: BLENDED_MENTOR_C.email,
        recorded_by_email: BLENDED_MENTOR_C.email,
        flag_comment:
          "JEE Main 2027 form not filled: Not aware about the exam; Other\nDetails: Synthetic: family is moving this month.",
      },
    ]);
    // Not filled writes nothing to the DB Service and leaves the reminder open.
    expect(await stubRequests()).toEqual([]);
    expect((await reminder(studentIds[mentee.key]))[0].status).toBe("open");
  });

  test("the program team sees the flag in the Flags feed", async ({ page }) => {
    await signInAs(page, BLENDED_ADMIN);
    await page.goto("/blended-learning?tab=flags");
    const flag = page
      .getByRole("region", { name: "Mentor Flags" })
      .getByRole("article")
      .filter({ hasText: fullName(mentee) });
    await expect(flag).toContainText("JEE form (program team)");
    await expect(flag).toContainText("JEE Main 2027 form not filled: Not aware about the exam; Other");
    await expect(flag).toContainText(BLENDED_MENTOR_C.name);
    await expect(flag.getByRole("button", { name: "Show Session Notes" })).toHaveCount(0);
  });

  test("Filled needs the number, records it through the DB Service and ticks the reminder", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(detailPath(mentee));
    const jee = card(page);
    await jee.getByRole("button", { name: "Change status" }).click();
    await jee.getByRole("radio", { name: "Filled", exact: true }).check();
    await jee.getByRole("button", { name: "Save" }).click();
    await expect(jee.getByText("Enter the application number.")).toBeVisible();
    await jee.getByLabel("Application number").fill("E2E-JEE-0001");
    await jee.getByRole("button", { name: "Save" }).click();

    await expect(jee.getByText("E2E-JEE-0001")).toBeVisible();
    await expect(jee.getByText("Not uploaded")).toBeVisible();
    await expect(jee.getByText(JEE_REMINDER_TEXT)).toHaveClass(/line-through/);
    await expect(jee.getByText("Done")).toBeVisible();
    await expect(page.getByRole("region", { name: "Open Action Items" })).toHaveCount(0);
    await jee.getByText("Earlier updates (1)").click();
    await expect(jee.getByText(/Not filled · Not aware about the exam; Other/)).toBeVisible();

    const studentId = studentIds[mentee.key];
    expect(await stubRequests()).toEqual([
      {
        method: "POST",
        path: "/api/student-exam-record",
        body: { student_id: studentId, exam_id: expect.any(Number), exam_year: 2027, application_number: "E2E-JEE-0001" },
      },
    ]);
    expect(await jeeRecords(studentId)).toEqual([
      { id: expect.any(String), exam_year: 2027, application_number: "E2E-JEE-0001", password_kept: true },
    ]);
    expect(await reminder(studentId)).toEqual([
      { status: "done", ticked_by_jee_form: true, completed_by_email: BLENDED_MENTOR_C.email },
    ]);
    expect((await updates(studentId)).map((update) => update.status)).toEqual(["not_filled", "filled"]);
  });

  test("a read-only admin sees the card without controls and can't record", async ({ page }) => {
    await signInAs(page, BLENDED_ADMIN_READ_ONLY);
    await page.goto(detailPath(mentee));
    const jee = card(page);
    await expect(jee.getByText("E2E-JEE-0001")).toBeVisible();
    await expect(jee.getByRole("button")).toHaveCount(0);
    const res = await page.request.post(jeeFormUrl(mentee), { multipart: { status: "not_filled", reasons: "not_aware" } });
    expect(res.status()).toBe(403);
  });

  test("another Mentor can't record for this Mentee", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_A);
    const res = await page.request.post(jeeFormUrl(mentee), { multipart: { status: "not_filled", reasons: "not_aware" } });
    expect(res.status()).toBe(404);
    expect((await updates(studentIds[mentee.key])).length).toBe(2);
  });
});

test.describe("Blended Learning JEE form card — Mentor, mobile 360", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  const mentee = JEE_FORM_MENTEES.mobile;

  test("updates the yearless JEE Mains record holding the number, never reading or showing its password", async ({ page }) => {
    await fetch(`${STUB}/__requests`, { method: "DELETE" });
    const studentId = studentIds[mentee.key];
    const [existing] = await jeeRecords(studentId, JEE_EXISTING_RECORD.password);
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(detailPath(mentee));
    const jee = card(page);
    await jee.getByRole("radio", { name: "Filled", exact: true }).check();
    await jee.getByLabel("Application number").fill(JEE_EXISTING_RECORD.applicationNumber);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const response = page.waitForResponse((res) => res.url().endsWith(jeeFormUrl(mentee)));
    await jee.getByRole("button", { name: "Save" }).click();
    const saved = await response;

    expect(saved.status()).toBe(201);
    expect(await saved.text()).not.toMatch(/password/i);
    await expect(jee.getByText(JEE_EXISTING_RECORD.applicationNumber)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await stubRequests()).toEqual([
      {
        method: "PATCH",
        path: `/api/student-exam-record/${existing.id}`,
        body: { application_number: JEE_EXISTING_RECORD.applicationNumber, exam_year: 2027 },
      },
    ]);
    // Still one record, now for 2027, its password untouched.
    expect(await jeeRecords(studentId, JEE_EXISTING_RECORD.password)).toEqual([
      { id: existing.id, exam_year: 2027, application_number: JEE_EXISTING_RECORD.applicationNumber, password_kept: true },
    ]);
    expect(await page.content()).not.toContain(JEE_EXISTING_RECORD.password);
  });
});

test.describe("Blended Learning JEE form card — Blended Learning Admin", () => {
  const mentee = JEE_FORM_MENTEES.admin;

  test("an admin records for any mapped Mentee, kept against the mapped Mentor", async ({ page }) => {
    await signInAs(page, BLENDED_ADMIN);
    await page.goto(detailPath(mentee));
    const jee = card(page);
    await jee.getByRole("radio", { name: "Not filled", exact: true }).check();
    await jee.getByRole("group", { name: REASONS }).getByRole("checkbox", { name: "Will attempt Phase -2 test" }).check();
    await jee.getByRole("button", { name: "Save" }).click();
    await expect(jee.getByText("Flagged to the program team")).toBeVisible();

    expect(await updates(studentIds[mentee.key])).toEqual([
      expect.objectContaining({
        status: "not_filled",
        reasons: ["phase_two"],
        details: null,
        mentor_email: BLENDED_MENTOR_C.email,
        recorded_by_email: BLENDED_ADMIN.email,
      }),
    ]);
  });
});

test("no request the card made to the DB Service carried a password", async () => {
  for (const request of await stubRequests()) expect(JSON.stringify(request.body ?? {})).not.toMatch(/password/i);
});
