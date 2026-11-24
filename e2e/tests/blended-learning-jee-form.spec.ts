import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_C,
  JEE_EXISTING_RECORD,
  JEE_FORM_MENTEES,
  JEE_REMINDER_TEXT,
  fullName,
} from "../helpers/blended-learning-fixtures";

// The JEE Form tab (/blended-learning/jee-form), the Mentee page's JEE status
// line and the reminder's rule, against the real fixture DDL and the e2e DB
// Service stub (e2e/helpers/db-service-stub.mjs), which writes
// student_exam_record the way the DB Service does. Mentor C's JEE form
// Mentees exist only for this spec; the tests build on each other, so they
// run in order. E2E has no S3, so the confirmation PDF upload is covered by
// the route tests; here only its control is checked. The exam-portal password
// is encrypted and revealed against the stub's fake KMS; the passwords below
// are synthetic.
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const STUB = "http://localhost:3902";
const TAB = "/blended-learning/jee-form";
const STATUS_LINE = "JEE Main 2027 form";
const STATUS_QUESTION = "Has the student filled the form?";
const REASONS = "Why hasn't it been filled?";
const PASSWORD_LABEL = "Exam portal password";
const MENTOR_PASSWORD = "e2e-portal-pass-1";
const PHONE_PASSWORD = "e2e-portal-pass-2";
// What an admin tries to save, refused: it must reach neither KMS nor the DB Service.
const ADMIN_PASSWORD = "e2e-admin-pass-9";
// What a save whose Mapping ends while it waits tries to save, refused the same way.
const RACED_PASSWORD = "e2e-portal-pass-3";

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

async function allStubRequests(): Promise<StubRequest[]> {
  return (await fetch(`${STUB}/__requests`)).json();
}

// What the app sent the DB Service (the fake KMS calls aside).
async function stubRequests(): Promise<StubRequest[]> {
  return (await allStubRequests()).filter((request) => request.path !== "/kms");
}

// The fake KMS operations the app called, in order.
async function kmsCalls(): Promise<string[]> {
  return (await allStubRequests()).filter((request) => request.path === "/kms").map((request) => String(request.body?.target));
}

function passwordUrl(mentee: { key: string }) {
  return `/api/blended-learning/students/${studentIds[mentee.key]}/jee-form/password`;
}

// The reveal log's rows for a Student.
async function reveals(studentId: number) {
  return withPool(async (pool) => {
    const result = await pool.query<{ viewer_email: string; viewer_role: string; on_jee_record: boolean }>(
      `SELECT r.viewer_email, r.viewer_role,
              EXISTS (SELECT 1 FROM student_exam_record ser
                      WHERE ser.id = r.student_exam_record_id AND ser.student_id = r.student_id
                        AND ser.exam_id = r.exam_id AND ser.exam_year = 2027) AS on_jee_record
       FROM lms_exam_password_reveals r WHERE r.student_id = $1 ORDER BY r.id`,
      [studentId]
    );
    return result.rows;
  });
}

function detailPath(mentee: { key: string }) {
  return `/blended-learning/students/${studentIds[mentee.key]}`;
}

function jeeFormUrl(mentee: { key: string }) {
  return `/api/blended-learning/students/${studentIds[mentee.key]}/jee-form`;
}

function tabFor(mentee: { key: string }) {
  return `${TAB}?student=${studentIds[mentee.key]}`;
}

// A Student's row in the tab, and the button that opens and closes it.
function row(page: Page, mentee: { key: string }): Locator {
  return page.locator(`#jee-student-${studentIds[mentee.key]}`);
}

function rowToggle(page: Page, mentee: { key: string }): Locator {
  return row(page, mentee).locator(":scope > button");
}

function statusLine(page: Page): Locator {
  return page.getByRole("region", { name: STATUS_LINE });
}

async function shownCounts(page: Page) {
  const values = await page.getByLabel("JEE form counts").locator("dd").allTextContents();
  return { filled: Number(values[0]), notFilled: Number(values[1]), notRecorded: Number(values[2]) };
}

// What the counts should be: a Mentor's (or everyone's) Students with an
// active current-year Mapping (its period contains now), not marked a dropout
// (the tab hides them), by their latest update.
async function expectedCounts(mentorEmail: string | null) {
  return withPool(async (pool) => {
    const result = await pool.query<{ filled: string; not_filled: string; not_recorded: string; total: string }>(
      `SELECT count(*) FILTER (WHERE latest.status = 'filled') AS filled,
              count(*) FILTER (WHERE latest.status = 'not_filled') AS not_filled,
              count(*) FILTER (WHERE latest.status IS NULL) AS not_recorded,
              count(*) AS total
       FROM blended_learning_mentor_mentee_mappings mapping
       LEFT JOIN LATERAL (
         SELECT u.status FROM blended_learning_jee_form_updates u
         WHERE u.student_id = mapping.student_id ORDER BY u.id DESC LIMIT 1
       ) latest ON true
       WHERE mapping.academic_year = $1 AND mapping.started_at <= (now() AT TIME ZONE 'UTC')
         AND (mapping.ended_at IS NULL OR mapping.ended_at > (now() AT TIME ZONE 'UTC'))
         AND NOT EXISTS (SELECT 1 FROM student st WHERE st.id = mapping.student_id AND st.status = 'dropout')
         AND ($2::text IS NULL OR mapping.mentor_user_id = (SELECT id FROM "user" WHERE email = $2))`,
      [CURRENT_ACADEMIC_YEAR, mentorEmail]
    );
    const counts = result.rows[0];
    return {
      filled: Number(counts.filled),
      notFilled: Number(counts.not_filled),
      notRecorded: Number(counts.not_recorded),
      total: Number(counts.total),
    };
  });
}

async function expectCounts(page: Page, mentorEmail: string | null) {
  const { total, ...counts } = await expectedCounts(mentorEmail);
  await expect.poll(() => shownCounts(page)).toEqual(counts);
  return total;
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

// The Student's JEE Mains records. Of the legacy plaintext password only
// whether it is empty, of the ciphertext only whether there is one.
async function jeeRecords(studentId: number) {
  return withPool(async (pool) => {
    const result = await pool.query<{
      id: string;
      exam_year: number | null;
      application_number: string;
      legacy_cleared: boolean;
      ciphertext_saved: boolean;
    }>(
      `SELECT ser.id, ser.exam_year, ser.application_number,
              ser.application_password IS NULL AS legacy_cleared,
              ser.application_password_ciphertext IS NOT NULL AS ciphertext_saved
       FROM student_exam_record ser JOIN exam ON exam.id = ser.exam_id
       WHERE ser.student_id = $1 AND exam.name = 'JEE Mains'
       ORDER BY ser.id`,
      [studentId]
    );
    return result.rows;
  });
}

// Change the Student's JEE Mains 2027 application number directly, as an
// Exams tab edit would.
async function setJeeRecordNumber(studentId: number, applicationNumber: string) {
  await withPool((pool) =>
    pool.query(
      `UPDATE student_exam_record ser SET application_number = $2
       FROM exam WHERE exam.id = ser.exam_id AND exam.name = 'JEE Mains' AND ser.student_id = $1 AND ser.exam_year = 2027`,
      [studentId, applicationNumber]
    )
  );
}

async function reminder(studentId: number) {
  return withPool(async (pool) => {
    const result = await pool.query<{
      id: string;
      status: string;
      ticked_by_jee_form: boolean;
      completed_by_email: string | null;
    }>(
      `SELECT id, status, completed_by_jee_form_update_id IS NOT NULL AS ticked_by_jee_form, completed_by_email
       FROM blended_learning_action_items WHERE student_id = $1 AND text = $2`,
      [studentId, JEE_REMINDER_TEXT]
    );
    return result.rows;
  });
}


async function conversationCount(studentId: number) {
  return withPool(async (pool) => {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*) FROM blended_learning_conversations WHERE student_id = $1`,
      [studentId]
    );
    return Number(result.rows[0].count);
  });
}

test.describe("Blended Learning JEE Form tab — Mentor, desktop", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 800 } });
  const mentee = JEE_FORM_MENTEES.mentor;

  test("lists the Mentor's own Students with counts, and filters by status in the URL", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto("/blended-learning");
    const tabs = page.getByRole("navigation", { name: "Mentor views" });
    await tabs.getByRole("link", { name: "JEE Form" }).click();
    await expect(page).toHaveURL(TAB);
    await expect(tabs.getByRole("link", { name: "JEE Form" })).toHaveAttribute("aria-current", "page");

    const total = await expectCounts(page, BLENDED_MENTOR_C.email);
    const students = page.getByRole("list", { name: "Students" });
    await expect(students.locator(":scope > li")).toHaveCount(total);
    await expect(row(page, mentee)).toContainText(fullName(mentee));
    await expect(row(page, mentee)).toContainText("Not recorded");
    // No Mentor filter or Mentor names on a Mentor's own list.
    await expect(page.getByRole("combobox", { name: "Mentor" })).toHaveCount(0);

    const status = page.getByRole("group", { name: "Status" });
    await status.getByRole("button", { name: "Filled", exact: true }).click();
    await expect(page).toHaveURL(`${TAB}?status=filled`);
    await expect(row(page, mentee)).toHaveCount(0);
    await status.getByRole("button", { name: "Not recorded" }).click();
    await expect(page).toHaveURL(`${TAB}?status=not_recorded`);
    await expect(row(page, mentee)).toBeVisible();
  });

  test("Not filled needs a reason, and details for Other; saving updates the row and counts in place and flags", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(`${TAB}?status=not_recorded`);
    await rowToggle(page, mentee).click();
    await expect(rowToggle(page, mentee)).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(`${TAB}?status=not_recorded&student=${studentIds[mentee.key]}`);

    const open = row(page, mentee);
    await expect(open.getByRole("group", { name: STATUS_QUESTION }).getByRole("radio")).toHaveCount(2);
    await expect(open.getByText(/password/i)).toHaveCount(0);
    await open.getByRole("radio", { name: "Not filled", exact: true }).check();
    const reasons = open.getByRole("group", { name: REASONS });
    await expect(reasons.getByRole("checkbox")).toHaveCount(11);
    await open.getByRole("button", { name: "Save" }).click();
    await expect(open.getByText("Choose at least one reason.")).toBeVisible();
    await reasons.getByRole("checkbox", { name: "Not aware about the exam" }).check();
    await reasons.getByRole("checkbox", { name: "Other" }).check();
    await open.getByRole("button", { name: "Save" }).click();
    await expect(open.getByText("Describe the other reason.")).toBeVisible();
    await open.getByLabel("Details", { exact: true }).fill("Synthetic: family is moving this month.");
    await open.getByRole("button", { name: "Save" }).click();

    await expect(open.getByRole("status")).toHaveText("Saved");
    await expect(open.getByText("Flagged to the program team")).toBeVisible();
    // The row updates in place and stays listed under the filter; no navigation.
    await expect(rowToggle(page, mentee)).toContainText("Not filled");
    await expect(rowToggle(page, mentee)).toContainText("Not aware about the exam; Other");
    await expect(page).toHaveURL(`${TAB}?status=not_recorded&student=${studentIds[mentee.key]}`);
    await expectCounts(page, BLENDED_MENTOR_C.email);

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

  test("the Mentee page shows the status line, and its link opens the Student's row in the tab", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(detailPath(mentee));
    const line = statusLine(page);
    await expect(line).toContainText("Not filled");
    await expect(line).toContainText("Not aware about the exam; Other");
    // The full form is no longer on the Mentee page.
    await expect(page.getByRole("group", { name: STATUS_QUESTION })).toHaveCount(0);
    // The reminder is open, with a link instead of a tick.
    const reminderItem = page.getByRole("region", { name: "Open Action Items" }).getByRole("listitem").filter({ hasText: JEE_REMINDER_TEXT });
    await expect(reminderItem.getByRole("link", { name: "Fill in JEE tab" })).toHaveAttribute("href", tabFor(mentee));

    await line.getByRole("link", { name: "Update in JEE tab" }).click();
    await expect(page).toHaveURL(tabFor(mentee));
    await expect(rowToggle(page, mentee)).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, mentee).getByRole("radio", { name: "Not filled", exact: true })).toBeChecked();
    await expect(row(page, mentee)).toBeInViewport();
  });

  test("Filled needs the number and the password, records them through the DB Service (the password as ciphertext) and ticks the reminder", async ({ page }) => {
    await fetch(`${STUB}/__requests`, { method: "DELETE" });
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(tabFor(mentee));
    const open = row(page, mentee);
    await open.getByRole("radio", { name: "Filled", exact: true }).check();
    await expect(open.getByText(/Saving ticks the student's “JEE Form Filling \(Reminder\)” action item/)).toBeVisible();
    await expect(open.getByLabel(/Confirmation page/)).toHaveAttribute("type", "file");
    await expect(open.getByLabel(PASSWORD_LABEL)).toHaveAttribute("type", "password");
    await open.getByRole("button", { name: "Save" }).click();
    await expect(open.getByText("Enter the application number.")).toBeVisible();
    await expect(open.getByText("Enter the exam portal password.")).toBeVisible();
    await open.getByLabel("Application number").fill("E2E-JEE-0001");
    await open.getByRole("button", { name: "Save" }).click();
    // No number now and password later: the form isn't sent without it.
    await expect(open.getByText("Enter the exam portal password.")).toBeVisible();
    expect(await stubRequests()).toEqual([]);
    // Nor does the server take one.
    const partial = await page.request.post(jeeFormUrl(mentee), {
      multipart: { status: "filled", applicationNumber: "E2E-JEE-0001" },
    });
    expect(partial.status()).toBe(422);
    expect((await partial.json()).fieldErrors).toEqual({ password: "Enter the exam portal password." });

    await open.getByLabel(PASSWORD_LABEL).fill(MENTOR_PASSWORD);
    await open.getByRole("button", { name: "Save" }).click();

    await expect(open.getByRole("status")).toHaveText("Saved");
    await expect(rowToggle(page, mentee)).toContainText("Filled");
    await expect(rowToggle(page, mentee)).toContainText("E2E-JEE-0001");
    await expect(open.getByText("Not uploaded")).toBeVisible();
    await expect(open.getByText(JEE_REMINDER_TEXT)).toHaveClass(/line-through/);
    await expect(open.getByText("Done")).toBeVisible();
    await open.getByText("Earlier updates (1)").click();
    await expect(open.getByText(/Not filled · Not aware about the exam; Other/)).toBeVisible();
    await expectCounts(page, BLENDED_MENTOR_C.email);

    const studentId = studentIds[mentee.key];
    const [created] = await stubRequests();
    expect(created).toEqual({
      method: "POST",
      path: "/api/student-exam-record",
      body: {
        student_id: studentId,
        exam_id: expect.any(Number),
        exam_year: 2027,
        application_number: "E2E-JEE-0001",
        application_password: null,
        application_password_ciphertext: expect.any(String),
      },
    });
    expect(created.body?.application_password_ciphertext).not.toContain(MENTOR_PASSWORD);
    expect(await kmsCalls()).toEqual(["TrentService.Encrypt"]);
    // The legacy plaintext column stays empty; only the ciphertext is stored.
    expect(await jeeRecords(studentId)).toEqual([
      { id: expect.any(String), exam_year: 2027, application_number: "E2E-JEE-0001", legacy_cleared: true, ciphertext_saved: true },
    ]);
    // Page data says only that one is saved.
    await expect(open.getByText("Exam portal password")).toBeVisible();
    expect(await page.content()).not.toContain(MENTOR_PASSWORD);
    expect(await reminder(studentId)).toEqual([
      expect.objectContaining({ status: "done", ticked_by_jee_form: true, completed_by_email: BLENDED_MENTOR_C.email }),
    ]);
    expect((await updates(studentId)).map((update) => update.status)).toEqual(["not_filled", "filled"]);

    // The Mentee page now shows Filled, and the reminder is no longer open.
    await page.goto(detailPath(mentee));
    await expect(statusLine(page)).toContainText("Filled");
    await expect(statusLine(page)).toContainText("E2E-JEE-0001");
    await expect(page.getByRole("region", { name: "Open Action Items" }).getByText(JEE_REMINDER_TEXT)).toHaveCount(0);
  });

  test("the Mentor reveals their own Mentee's password with Show password, and each reveal is logged", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(tabFor(mentee));
    const open = row(page, mentee);
    await expect(open.getByText("Password saved")).toBeVisible();
    await expect(open.getByLabel(PASSWORD_LABEL)).toHaveCount(0);
    // The row is server-rendered open: wait for hydration, or the click lands
    // on a button with no handler yet.
    await page.waitForLoadState("networkidle");
    const response = page.waitForResponse((res) => res.url().endsWith(passwordUrl(mentee)));
    await open.getByRole("button", { name: "Show password" }).click();
    const revealed = await response;
    expect(revealed.request().method()).toBe("POST");
    expect(revealed.headers()["cache-control"]).toBe("no-store");
    await expect(open.getByText(MENTOR_PASSWORD)).toBeVisible();
    await open.getByRole("button", { name: "Hide password" }).click();
    await expect(open.getByText(MENTOR_PASSWORD)).toHaveCount(0);

    expect(await reveals(studentIds[mentee.key])).toEqual([
      { viewer_email: BLENDED_MENTOR_C.email, viewer_role: "blended_mentor", on_jee_record: true },
    ]);

    // Saving again without a new password keeps it.
    await open.getByRole("button", { name: "Save" }).click();
    await expect(open.getByRole("status")).toHaveText("Saved");
    expect(await jeeRecords(studentIds[mentee.key])).toEqual([expect.objectContaining({ ciphertext_saved: true })]);
  });

  test("shows the exam record's number after an edit outside the form, and re-saving it records nothing new", async ({ page }) => {
    const studentId = studentIds[mentee.key];
    const before = await updates(studentId);
    await setJeeRecordNumber(studentId, "E2E-JEE-0002");
    try {
      await fetch(`${STUB}/__requests`, { method: "DELETE" });
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(tabFor(mentee));
      await expect(rowToggle(page, mentee)).toContainText("E2E-JEE-0002");
      const open = row(page, mentee);
      await expect(open.getByLabel("Application number")).toHaveValue("E2E-JEE-0002");

      // Saving the form as shown is no change: no update, no DB Service write.
      await page.waitForLoadState("networkidle");
      const response = page.waitForResponse((res) => res.url().endsWith(jeeFormUrl(mentee)));
      await open.getByRole("button", { name: "Save" }).click();
      expect((await response).status()).toBe(200);
      expect(await updates(studentId)).toEqual(before);
      expect(await stubRequests()).toEqual([]);

      // The Mentee page's line shows it too; the history keeps what was recorded.
      await page.goto(detailPath(mentee));
      await expect(statusLine(page)).toContainText("E2E-JEE-0002");
      expect((await updates(studentId)).at(-1)?.application_number).toBe("E2E-JEE-0001");
    } finally {
      await setJeeRecordNumber(studentId, "E2E-JEE-0001");
    }
  });

  test("a read-only admin sees the tab and opens a row, but can't record or reveal the password", async ({ page }) => {
    await fetch(`${STUB}/__requests`, { method: "DELETE" });
    const studentId = studentIds[mentee.key];
    const logged = (await reveals(studentId)).length;
    await signInAs(page, BLENDED_ADMIN_READ_ONLY);
    await page.goto(tabFor(mentee));
    const open = row(page, mentee);
    await expect(rowToggle(page, mentee)).toHaveAttribute("aria-expanded", "true");
    await expect(open.getByText("E2E-JEE-0001").first()).toBeVisible();
    await expect(open.getByRole("radio")).toHaveCount(0);
    await expect(open.getByRole("button", { name: "Change status" })).toBeDisabled();
    await expect(open.getByRole("button", { name: "Change status" })).toHaveAttribute("title", "View only");
    const res = await page.request.post(jeeFormUrl(mentee), { multipart: { status: "not_filled", reasons: "not_aware" } });
    expect(res.status()).toBe(403);
    // Revealing needs edit rights: the read-only admin sees the password is
    // saved, with Show password disabled as View only...
    await expect(open.getByText("Saved", { exact: true })).toBeVisible();
    const show = open.getByRole("button", { name: "Show password" });
    await expect(show).toBeDisabled();
    await expect(show).toHaveAttribute("title", "View only");
    // ...and the server refuses the reveal: nothing decrypted, nothing logged.
    const reveal = await page.request.post(passwordUrl(mentee));
    expect(reveal.status()).toBe(403);
    expect(await reveal.text()).not.toContain(MENTOR_PASSWORD);
    expect(await kmsCalls()).toEqual([]);
    expect((await reveals(studentId)).length).toBe(logged);
    expect((await reveals(studentId)).map((logRow) => logRow.viewer_email)).not.toContain(BLENDED_ADMIN_READ_ONLY.email);

    await page.goto(detailPath(mentee));
    await expect(statusLine(page).getByRole("link", { name: "View in JEE tab" })).toHaveAttribute("href", tabFor(mentee));
  });

  test("a Blended Learning Admin sees the form view only, can't save it or replace the password, but reveals it, logged", async ({ page }) => {
    await fetch(`${STUB}/__requests`, { method: "DELETE" });
    const studentId = studentIds[mentee.key];
    const before = await updates(studentId);
    await signInAs(page, BLENDED_ADMIN);
    await page.goto(tabFor(mentee));
    const open = row(page, mentee);
    await expect(rowToggle(page, mentee)).toHaveAttribute("aria-expanded", "true");
    await expect(open.getByText("E2E-JEE-0001").first()).toBeVisible();
    // No form, no password field and no Replace: the status button stays, disabled.
    await expect(open.getByRole("group", { name: STATUS_QUESTION })).toHaveCount(0);
    await expect(open.getByRole("radio")).toHaveCount(0);
    await expect(open.getByLabel(PASSWORD_LABEL)).toHaveCount(0);
    await expect(open.getByRole("button", { name: "Replace password" })).toHaveCount(0);
    const change = open.getByRole("button", { name: "Change status" });
    await expect(change).toBeDisabled();
    await expect(change).toHaveAttribute("title", "View only");

    // The server refuses an admin's save too, with or without a new password.
    for (const multipart of [
      { status: "filled", applicationNumber: "E2E-JEE-0009", password: ADMIN_PASSWORD },
      { status: "filled", applicationNumber: "E2E-JEE-0001" },
      { status: "not_filled", reasons: "not_aware" },
    ]) {
      const res = await page.request.post(jeeFormUrl(mentee), { multipart });
      expect(res.status()).toBe(403);
    }
    expect(await updates(studentId)).toEqual(before);
    expect(await stubRequests()).toEqual([]);
    expect(await kmsCalls()).toEqual([]);
    expect(await jeeRecords(studentId)).toEqual([
      expect.objectContaining({ application_number: "E2E-JEE-0001", ciphertext_saved: true }),
    ]);

    // Show password still works for an admin, and the reveal is logged.
    await page.waitForLoadState("networkidle");
    await open.getByRole("button", { name: "Show password" }).click();
    await expect(open.getByText(MENTOR_PASSWORD)).toBeVisible();
    expect((await reveals(studentId)).at(-1)).toEqual({
      viewer_email: BLENDED_ADMIN.email,
      viewer_role: "blended_admin",
      on_jee_record: true,
    });

    await page.goto(detailPath(mentee));
    await expect(statusLine(page).getByRole("link", { name: "View in JEE tab" })).toHaveAttribute("href", tabFor(mentee));
  });

  test("another Mentor doesn't see this Mentee in their tab and can't record for them", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_A);
    await page.goto(tabFor(mentee));
    await expect(page.getByRole("group", { name: "Status" })).toBeVisible();
    await expect(row(page, mentee)).toHaveCount(0);
    const res = await page.request.post(jeeFormUrl(mentee), { multipart: { status: "not_filled", reasons: "not_aware" } });
    expect(res.status()).toBe(404);
    expect((await updates(studentIds[mentee.key])).length).toBe(2);
    // Nor reveal their password: not found, as the save is, and nothing logged.
    const logged = (await reveals(studentIds[mentee.key])).length;
    const reveal = await page.request.post(passwordUrl(mentee));
    expect(reveal.status()).toBe(404);
    expect(await reveal.text()).not.toContain(MENTOR_PASSWORD);
    expect((await reveals(studentIds[mentee.key])).length).toBe(logged);
  });

  // The save takes a per-Student lock, then re-checks the Mapping, and only
  // then calls KMS and the DB Service. Holding that lock here makes the save
  // pass the scope check and wait; the Mapping ends meanwhile.
  test("a save whose Mapping ends while it waits for the Student's lock is refused (404), touching no exam record", async ({ page }) => {
    await fetch(`${STUB}/__requests`, { method: "DELETE" });
    const studentId = studentIds[mentee.key];
    const recordsBefore = await jeeRecords(studentId);
    const updatesBefore = await updates(studentId);
    await signInAs(page, BLENDED_MENTOR_C);

    const pool = getTestPool();
    const holder = await pool.connect();
    const lockKey = `blended_learning_jee_form:${studentId}`;
    let endedIds: string[] = [];
    try {
      await holder.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      const holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const saving = page.request.post(jeeFormUrl(mentee), {
        multipart: { status: "filled", applicationNumber: "E2E-JEE-0002", password: RACED_PASSWORD },
      });
      // The save is waiting on the lock this connection holds.
      await expect
        .poll(async () => {
          const result = await pool.query<{ waiting: number }>(
            `SELECT count(*)::int AS waiting
             FROM pg_locks waiter
             JOIN pg_locks held
               ON held.locktype = 'advisory' AND held.granted AND held.pid = $1
              AND waiter.classid = held.classid AND waiter.objid = held.objid AND waiter.objsubid = held.objsubid
             WHERE waiter.locktype = 'advisory' AND NOT waiter.granted`,
            [holderPid]
          );
          return result.rows[0].waiting;
        })
        .toBe(1);
      const ended = await pool.query<{ id: string }>(
        `UPDATE blended_learning_mentor_mentee_mappings
         SET ended_at = GREATEST(started_at, date_trunc('second', now() AT TIME ZONE 'UTC')),
             ended_by_email = 'e2e-race@example.com', end_source = 'e2e_race', end_reason = 'e2e_race'
         WHERE student_id = $1 AND academic_year = $2 AND ended_at IS NULL
         RETURNING id`,
        [studentId, CURRENT_ACADEMIC_YEAR]
      );
      endedIds = ended.rows.map((mapping) => mapping.id);
      expect(endedIds).toHaveLength(1);
      await holder.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]);

      const res = await saving;
      expect(res.status()).toBe(404);
      expect(await res.text()).not.toContain(RACED_PASSWORD);
    } finally {
      await holder.query("SELECT pg_advisory_unlock_all()");
      holder.release();
      // Map the Student again for the specs that follow.
      if (endedIds.length > 0) {
        await pool.query(
          `UPDATE blended_learning_mentor_mentee_mappings
           SET ended_at = NULL, ended_by_email = NULL, end_source = NULL, end_reason = NULL
           WHERE id = ANY($1::bigint[])`,
          [endedIds]
        );
      }
      await pool.end();
    }

    // Nothing reached KMS or the DB Service, and nothing was recorded.
    expect(await stubRequests()).toEqual([]);
    expect(await kmsCalls()).toEqual([]);
    expect(await jeeRecords(studentId)).toEqual(recordsBefore);
    expect(await updates(studentId)).toEqual(updatesBefore);
  });
});

test.describe("Blended Learning JEE Form tab — Mentor, phone 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const mentee = JEE_FORM_MENTEES.mobile;

  test("fits the phone and updates the yearless JEE Mains record holding the number, clearing but never reading or showing its legacy password", async ({ page }) => {
    await fetch(`${STUB}/__requests`, { method: "DELETE" });
    const studentId = studentIds[mentee.key];
    const [existing] = await jeeRecords(studentId);
    // The seeded record holds a legacy plaintext password.
    expect(existing.legacy_cleared).toBe(false);
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(TAB);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // Rows and the status filter are comfortable tap targets.
    const toggle = rowToggle(page, mentee);
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    for (const button of await page.getByRole("group", { name: "Status" }).getByRole("button").all()) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await toggle.click();
    const open = row(page, mentee);
    await open.getByRole("radio", { name: "Filled", exact: true }).check();
    await open.getByLabel("Application number").fill(JEE_EXISTING_RECORD.applicationNumber);
    // A legacy plaintext password doesn't count as saved: the form asks again.
    await open.getByLabel(PASSWORD_LABEL).fill(PHONE_PASSWORD);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const response = page.waitForResponse((res) => res.url().endsWith(jeeFormUrl(mentee)));
    await open.getByRole("button", { name: "Save" }).click();
    const saved = await response;

    expect(saved.status()).toBe(201);
    const savedText = await saved.text();
    for (const secret of [JEE_EXISTING_RECORD.password, PHONE_PASSWORD]) expect(savedText).not.toContain(secret);
    expect(savedText).not.toMatch(/application_password|ciphertext/i);
    expect((await saved.json()).form.passwordSaved).toBe(true);
    await expect(rowToggle(page, mentee)).toContainText(JEE_EXISTING_RECORD.applicationNumber);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await stubRequests()).toEqual([
      {
        method: "PATCH",
        path: `/api/student-exam-record/${existing.id}`,
        body: {
          application_number: JEE_EXISTING_RECORD.applicationNumber,
          exam_year: 2027,
          application_password: null,
          application_password_ciphertext: expect.any(String),
        },
      },
    ]);
    // Still one record, now for 2027, with the ciphertext; the legacy column
    // was never read, and is now cleared, as the Exams tab clears it.
    expect(await jeeRecords(studentId)).toEqual([
      {
        id: existing.id,
        exam_year: 2027,
        application_number: JEE_EXISTING_RECORD.applicationNumber,
        legacy_cleared: true,
        ciphertext_saved: true,
      },
    ]);
    expect(await page.content()).not.toContain(JEE_EXISTING_RECORD.password);
  });
});

test.describe("Blended Learning JEE Form tab — Blended Learning Admin", () => {
  test.describe.configure({ mode: "serial" });
  const mentee = JEE_FORM_MENTEES.admin;

  test("sees every Mentor's Students and filters by Mentor, but can't record: only the Mentor does", async ({ page }) => {
    await signInAs(page, BLENDED_ADMIN);
    await page.goto(TAB);
    const everyone = await expectCounts(page, null);
    await expect(page.getByRole("list", { name: "Students" }).locator(":scope > li")).toHaveCount(everyone);
    await expect(rowToggle(page, mentee)).toContainText(BLENDED_MENTOR_C.name);

    const mentor = page.getByRole("combobox", { name: "Mentor" });
    await mentor.selectOption({ label: BLENDED_MENTOR_C.name });
    await expect(page).toHaveURL(/[?&]mentor=\d+/);
    const mentorC = await expectCounts(page, BLENDED_MENTOR_C.email);
    expect(mentorC).toBeLessThan(everyone);
    await expect(page.getByRole("list", { name: "Students" }).locator(":scope > li")).toHaveCount(mentorC);

    await rowToggle(page, mentee).click();
    const adminRow = row(page, mentee);
    await expect(adminRow.getByText("Not recorded yet.")).toBeVisible();
    await expect(adminRow.getByRole("radio")).toHaveCount(0);
    await expect(adminRow.getByRole("button", { name: "Record status" })).toBeDisabled();
    await expect(adminRow.getByRole("button", { name: "Record status" })).toHaveAttribute("title", "View only");
    const refused = await page.request.post(jeeFormUrl(mentee), {
      multipart: { status: "not_filled", reasons: "phase_two" },
    });
    expect(refused.status()).toBe(403);
    expect(await updates(studentIds[mentee.key])).toEqual([]);

    // The Mentee's Mentor records it, kept against the mapped Mentor.
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(tabFor(mentee));
    const open = row(page, mentee);
    await open.getByRole("radio", { name: "Not filled", exact: true }).check();
    await open.getByRole("group", { name: REASONS }).getByRole("checkbox", { name: "Will attempt Phase -2 test" }).check();
    await open.getByRole("button", { name: "Save" }).click();
    await expect(open.getByText("Flagged to the program team")).toBeVisible();
    await expectCounts(page, BLENDED_MENTOR_C.email);

    expect(await updates(studentIds[mentee.key])).toEqual([
      expect.objectContaining({
        status: "not_filled",
        reasons: ["phase_two"],
        details: null,
        mentor_email: BLENDED_MENTOR_C.email,
        recorded_by_email: BLENDED_MENTOR_C.email,
      }),
    ]);
  });

  test("the reminder stays open while Not filled: the log form links to the tab instead of a tick, and the server refuses a tick", async ({ page }) => {
    const studentId = studentIds[mentee.key];
    const [item] = await reminder(studentId);
    expect(item.status).toBe("open");
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(`${detailPath(mentee)}/log`);
    const panel = page.getByRole("region", { name: "Open Action Items" });
    const reminderItem = panel.getByRole("listitem").filter({ hasText: JEE_REMINDER_TEXT });
    await expect(reminderItem.getByRole("checkbox")).toHaveCount(0);
    await expect(reminderItem.getByRole("link", { name: "Fill in JEE tab" })).toHaveAttribute("href", tabFor(mentee));

    const conversations = await conversationCount(studentId);
    const res = await page.request.post(`/api/blended-learning/students/${studentId}/entries`, {
      data: {
        kind: "conversation",
        occurredOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
        mode: "call",
        spokeWith: "student",
        durationMinutes: 10,
        summary: "Synthetic: tries to tick the JEE reminder.",
        completeActionItemIds: [Number(item.id)],
      },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain("only by recording the JEE form as Filled in the JEE Form tab");
    expect(await conversationCount(studentId)).toBe(conversations);
    expect(await reminder(studentId)).toEqual([expect.objectContaining({ status: "open", ticked_by_jee_form: false })]);
  });
});

test("no request the tab made to the DB Service carried a plaintext password or a typed password", async () => {
  for (const request of await allStubRequests()) {
    const body = JSON.stringify(request.body ?? {});
    // The legacy column is only ever cleared, alongside a new ciphertext.
    const sent = (request.body ?? {}) as Record<string, unknown>;
    if ("application_password" in sent) {
      expect(sent.application_password).toBeNull();
      expect(typeof sent.application_password_ciphertext).toBe("string");
    }
    for (const secret of [MENTOR_PASSWORD, PHONE_PASSWORD, ADMIN_PASSWORD, RACED_PASSWORD]) {
      expect(body).not.toContain(secret);
    }
  }
});
