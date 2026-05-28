import { test, expect } from "../fixtures/auth";
import { getTestPool, seedStudentsForTest, type SeededIndividualStudent } from "../helpers/db";
import { setMockDbServiceState } from "../helpers/mock-db-service";
import { getCurrentAcademicYear } from "../../src/lib/academic-year";
import type { Page } from "@playwright/test";
import type { Pool } from "pg";

const SCHOOL_CODE = "70705";
const MENTORSHIP_TEACHER_EMAIL = "e2e-mentorship-teacher@test.local";
const ALTERNATE_MENTOR_EMAIL = "e2e-alternate-mentor@test.local";
const THIRD_MENTOR_EMAIL = "e2e-third-mentor@test.local";

let pool: Pool;
let academicYear: string;
let mentorshipTeacherId: number;
let alternateMentorId: number;
let students: SeededIndividualStudent[];

async function getTestUserId(email: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM user_permission WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (result.rows.length === 0) {
    throw new Error(`Test user not found: ${email}`);
  }
  return Number(result.rows[0].id);
}

async function upsertAcademicMentor(email: string, fullName: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO user_permission (
       email, level, role, program_ids, school_codes, regions, read_only, full_name
     )
     VALUES ($1, 1, 'teacher', ARRAY[1]::int[], ARRAY[$2]::text[], NULL, false, $3)
     ON CONFLICT (email) DO UPDATE SET
       level = 1,
       role = 'teacher',
       program_ids = ARRAY[1]::int[],
       school_codes = ARRAY[$2]::text[],
       regions = NULL,
       read_only = false,
       full_name = $3
     RETURNING id`,
    [email, SCHOOL_CODE, fullName]
  );
  return Number(result.rows[0].id);
}

async function seedAcademicMentorshipFixtures() {
  await pool.query(
    `WITH updated AS (
       UPDATE school
       SET name = 'E2E Academic Mentorship School',
           region = 'AHMEDABAD',
           district = COALESCE(NULLIF(district, ''), 'Ahmedabad'),
           state = COALESCE(NULLIF(state, ''), 'Gujarat'),
           af_school_category = 'JNV',
           udise_code = COALESCE(udise_code, code),
           program_ids = ARRAY[1, 2]::integer[],
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE code = $1
       RETURNING id
     )
     INSERT INTO school (
       code, name, inserted_at, updated_at, udise_code, af_school_category,
       region, state, district, program_ids
     )
     SELECT $1, 'E2E Academic Mentorship School',
            (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'), $1,
            'JNV', 'AHMEDABAD', 'Gujarat', 'Ahmedabad', ARRAY[1, 2]::integer[]
     WHERE NOT EXISTS (SELECT 1 FROM updated)`,
    [SCHOOL_CODE]
  );

  mentorshipTeacherId = await upsertAcademicMentor(
    MENTORSHIP_TEACHER_EMAIL,
    "E2E Mentorship Teacher"
  );
  alternateMentorId = await upsertAcademicMentor(ALTERNATE_MENTOR_EMAIL, "E2E Alternate Mentor");
  await upsertAcademicMentor(THIRD_MENTOR_EMAIL, "E2E Third Mentor");
  students = await seedStudentsForTest(pool, SCHOOL_CODE);
}

function initialMappings() {
  return [
    {
      id: 6701,
      mentor_id: mentorshipTeacherId,
      mentee_id: students[0].id,
      academic_year: academicYear,
      created_by: "e2e-admin@test.local",
      inserted_at: "2026-05-01T00:00:00.000Z",
    },
    {
      id: 6702,
      mentor_id: alternateMentorId,
      mentee_id: students[2].id,
      academic_year: academicYear,
      created_by: "e2e-admin@test.local",
      inserted_at: "2026-05-02T00:00:00.000Z",
    },
  ];
}

async function resetMockMappings() {
  await setMockDbServiceState({ mappings: initialMappings() });
}

async function openAcademicMentorshipAdmin(page: Page) {
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /Academic Mentorship/ })).toBeVisible();
  await page.getByRole("link", { name: /Academic Mentorship/ }).click();
  await page.waitForURL(/\/admin\/academic-mentorship/);
}

async function selectAcademicMentorshipSchool(page: Page) {
  await page.getByLabel("School").selectOption(SCHOOL_CODE);
  await expect(page.getByText(students[0].name)).toBeVisible();
}

test.beforeAll(async () => {
  pool = getTestPool();
  academicYear = getCurrentAcademicYear();
  await seedAcademicMentorshipFixtures();
});

test.afterAll(async () => {
  await pool?.end();
});

test.describe("Academic Mentorship", () => {
  test.beforeEach(async () => {
    await resetMockMappings();
  });

  test("CoE teacher sees only their own mentees on the school tab", async ({
    mentorshipTeacherPage,
  }) => {
    await mentorshipTeacherPage.goto("/school/70705");
    await mentorshipTeacherPage.getByRole("button", { name: "Academic Mentorship" }).click();

    await expect(mentorshipTeacherPage.getByText(students[0].name)).toBeVisible();
    await expect(mentorshipTeacherPage.getByText(students[2].name)).not.toBeVisible();
    await expect(mentorshipTeacherPage.getByRole("button", { name: "Coming Soon" })).toBeDisabled();
  });

  test("school tab visibility and mapping scope match role permissions", async ({
    adminPage,
    teacherPage,
    mentorshipTeacherPage,
    pmPage,
  }) => {
    await adminPage.goto(`/school/${SCHOOL_CODE}`);
    await adminPage.getByRole("button", { name: "Academic Mentorship" }).click();
    await expect(adminPage.getByText("E2E Mentorship Teacher")).toBeVisible();
    await expect(adminPage.getByText("E2E Alternate Mentor")).toBeVisible();

    await teacherPage.goto(`/school/${SCHOOL_CODE}`);
    // This persona is NVS-only; the assertion is NVS feature gating, not mentor eligibility.
    await expect(teacherPage.getByRole("button", { name: "Academic Mentorship" })).not.toBeVisible();

    await mentorshipTeacherPage.goto(`/school/${SCHOOL_CODE}`);
    await mentorshipTeacherPage.getByRole("button", { name: "Academic Mentorship" }).click();
    await expect(mentorshipTeacherPage.getByText(students[0].name)).toBeVisible();
    await expect(mentorshipTeacherPage.getByText(students[2].name)).not.toBeVisible();

    await pmPage.goto(`/school/${SCHOOL_CODE}`);
    await pmPage.getByRole("button", { name: "Academic Mentorship" }).click();
    await expect(pmPage.getByText("E2E Mentorship Teacher")).toBeVisible();
    await expect(pmPage.getByText("E2E Alternate Mentor")).toBeVisible();
  });

  test("admin can add, reassign, and unassign academic mentorship mappings", async ({
    adminPage,
  }) => {
    await openAcademicMentorshipAdmin(adminPage);
    await selectAcademicMentorshipSchool(adminPage);

    await adminPage.getByRole("button", { name: "Add Mapping" }).click();
    const mentorSelect = adminPage.getByRole("combobox", { name: "Mentor", exact: true });
    await expect(mentorSelect).toBeEnabled();
    await mentorSelect.selectOption(THIRD_MENTOR_EMAIL);
    await adminPage
      .getByRole("combobox", { name: "Mentee", exact: true })
      .selectOption(String(students[1].id));
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();

    await expect(adminPage.getByText("Mapping added")).toBeVisible();
    await expect(adminPage.getByText(students[1].name)).toBeVisible();

    await adminPage.getByRole("button", { name: `Reassign ${students[0].name}` }).click();
    const reassignDialog = adminPage.getByRole("dialog", { name: "Reassign mentee" });
    await reassignDialog.getByLabel("New mentor").selectOption(ALTERNATE_MENTOR_EMAIL);
    await reassignDialog.getByRole("button", { name: "Reassign" }).click();

    await expect(adminPage.getByText("Mapping reassigned")).toBeVisible();
    await expect(adminPage.locator("tr", { hasText: students[0].name })).toContainText(
      "E2E Alternate Mentor"
    );

    await adminPage.getByRole("button", { name: `Unassign ${students[1].name}` }).click();
    const unassignDialog = adminPage.getByRole("dialog", { name: "Unassign mentee" });
    await expect(unassignDialog).toContainText(
      `Unassign ${students[1].name} from E2E Third Mentor?`
    );
    await unassignDialog.getByRole("button", { name: "Confirm Unassign" }).click();

    await expect(adminPage.getByText("Mentee unassigned")).toBeVisible();
    await expect(adminPage.getByText(students[1].name)).not.toBeVisible();
  });

  test("CSV upload creates valid mappings, reports invalid rows, and is disabled for prior years", async ({
    adminPage,
  }) => {
    await setMockDbServiceState({ mappings: [] });
    await openAcademicMentorshipAdmin(adminPage);
    await adminPage.getByLabel("School").selectOption(SCHOOL_CODE);
    await expect(adminPage.getByText("No mappings found")).toBeVisible();

    await adminPage.getByRole("button", { name: "Upload CSV" }).click();
    let uploadDialog = adminPage.getByRole("dialog", { name: "Upload CSV" });
    await uploadDialog.locator('input[type="file"]').setInputFiles({
      name: "valid-mentorship.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `mentor_email,student_id\n${MENTORSHIP_TEACHER_EMAIL},${students[3].studentId}\n`
      ),
    });
    await expect(uploadDialog.getByText(students[3].studentId)).toBeVisible();
    await uploadDialog.getByRole("button", { name: "Upload" }).click();

    await expect(adminPage.getByText("Uploaded 1 mappings")).toBeVisible();
    await expect(adminPage.getByText(students[3].name)).toBeVisible();

    await adminPage.getByRole("button", { name: "Upload CSV" }).click();
    uploadDialog = adminPage.getByRole("dialog", { name: "Upload CSV" });
    await uploadDialog.locator('input[type="file"]').setInputFiles({
      name: "invalid-mentorship.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("mentor_email,student_id\nmissing@test.local,NO-STUDENT\n"),
    });
    await uploadDialog.getByRole("button", { name: "Upload" }).click();

    await expect(uploadDialog.getByText("Mentor is not eligible at this school")).toBeVisible();
    await expect(uploadDialog.getByText("Student not found")).toBeVisible();
    await uploadDialog.getByRole("button", { name: "Cancel" }).click();

    await adminPage.getByLabel("Academic Year").selectOption({ index: 1 });
    await expect(adminPage.getByRole("button", { name: "Upload CSV" })).toBeDisabled();
  });

  test("program admins see mutation controls only when their access is not read-only", async ({
    programAdminPage,
    readOnlyProgramAdminPage,
  }) => {
    await openAcademicMentorshipAdmin(programAdminPage);
    await selectAcademicMentorshipSchool(programAdminPage);
    await expect(programAdminPage.getByRole("button", { name: "Add Mapping" })).toBeVisible();
    await expect(programAdminPage.getByRole("button", { name: "Upload CSV" })).toBeVisible();
    await expect(programAdminPage.getByRole("button", { name: `Reassign ${students[0].name}` })).toBeVisible();

    await openAcademicMentorshipAdmin(readOnlyProgramAdminPage);
    await selectAcademicMentorshipSchool(readOnlyProgramAdminPage);
    await expect(readOnlyProgramAdminPage.getByText(students[0].name)).toBeVisible();
    await expect(readOnlyProgramAdminPage.getByRole("button", { name: "Add Mapping" })).not.toBeVisible();
    await expect(readOnlyProgramAdminPage.getByRole("button", { name: "Upload CSV" })).not.toBeVisible();
    await expect(
      readOnlyProgramAdminPage.getByRole("button", { name: `Reassign ${students[0].name}` })
    ).not.toBeVisible();
  });

  test("teacher deletion is blocked when active academic mentorship mappings exist", async ({
    adminPage,
  }) => {
    const mentorId = await getTestUserId(MENTORSHIP_TEACHER_EMAIL);
    await setMockDbServiceState({
      mappings: [
        {
          id: 6799,
          mentor_id: mentorId,
          mentee_id: students[0].id,
          academic_year: academicYear,
          created_by: "e2e-admin@test.local",
          inserted_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    const dialogMessages: string[] = [];
    adminPage.on("dialog", async (dialog) => {
      dialogMessages.push(dialog.message());
      if (dialog.type() === "confirm") {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    await adminPage.goto("/admin/users");
    const teacherRow = adminPage.locator("tr", { hasText: MENTORSHIP_TEACHER_EMAIL });
    await expect(teacherRow).toBeVisible();
    await teacherRow.getByRole("button", { name: "Delete" }).click();

    await expect
      .poll(() => dialogMessages.some((message) => message.includes("1 active mentee assignment")))
      .toBe(true);
    await expect(teacherRow).toBeVisible();
  });
});
