import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

const endpoint = "/api/holistic-mentorship/progress";
const filters = "academic_year=2026-2027&program_id=1&page=1&sort=school&direction=asc";

type Coverage = { eligible: number; assigned: number; unassigned: number };
type RosterStudent = { studentId: number; externalStudentId: string | null; grade: number; ownership: unknown };

async function progress(page: Page, query: string) {
  const response = await page.request.get(`${endpoint}?${query}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function rosterStudents(page: Page, schoolCode: string, query = ""): Promise<RosterStudent[]> {
  const response = await page.request.get(
    `/api/holistic-mentorship/mappings?school_code=${schoolCode}&program_id=1&academic_year=2026-2027${query}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).students;
}

// Independent source of truth: the Teacher School roster behind School Assignment Coverage.
async function rosterCoverage(page: Page, schoolCode: string, query = ""): Promise<Coverage> {
  const students = await rosterStudents(page, schoolCode, query);
  const assigned = students.filter(({ ownership }) => ownership !== null).length;
  return { eligible: students.length, assigned, unassigned: students.length - assigned };
}

async function fixtureSchoolCode() {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ school_code: string }>(
      `SELECT school_codes[1] AS school_code FROM user_permission
       WHERE LOWER(email) = 'e2e-holistic-teacher@test.local'`,
    );
    return result.rows[0].school_code;
  } finally {
    await pool.end();
  }
}

async function knownUnassignedGrade11Student(page: Page, schoolCode: string) {
  const student = (await rosterStudents(page, schoolCode))
    .find(({ grade, ownership }) => grade === 11 && ownership === null);
  expect(student, "the Holistic fixture leaves one Grade 11 Student unassigned").toBeDefined();
  return student!;
}

test("coverage adds up and matches assigned progress with no filters", async ({ holisticAdminPage }) => {
  const baseline = await progress(holisticAdminPage, filters);

  expect(baseline.coverage.eligible).toBeGreaterThan(0);
  expect(baseline.coverage.eligible).toBe(baseline.coverage.assigned + baseline.coverage.unassigned);
  expect(baseline.coverage.assigned).toBe(baseline.counts.total);
  expect(baseline.counts.total).toBe(
    baseline.counts.pending + baseline.counts.completed + baseline.counts.skipped + baseline.counts.noActivePhase,
  );
});

test("fixture School coverage matches the Teacher School roster", async ({ holisticAdminPage, holisticTeacherPage }) => {
  const schoolCode = await fixtureSchoolCode();
  const school = await progress(holisticAdminPage, `${filters}&school_code=${schoolCode}`);

  expect(school.coverage).toEqual(await rosterCoverage(holisticTeacherPage, schoolCode));
  expect(school.coverage.unassigned).toBeGreaterThan(0);
});

test("coverage ignores Phase, Progress, page and sort but follows Grade and search", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const schoolFilters = `${filters}&school_code=${schoolCode}`;
  const baseline = await progress(holisticAdminPage, filters);
  const phaseId = baseline.options.phases[0].id;
  for (const extra of [
    `&phase_id=${phaseId}`,
    "&progress=pending", "&progress=completed", "&progress=skipped", "&progress=no_active_phase",
    "&sort=progress&direction=desc", "&sort=student_name&direction=desc",
  ]) {
    expect((await progress(holisticAdminPage, `${filters}${extra}`)).coverage, extra).toEqual(baseline.coverage);
  }
  expect((await progress(holisticAdminPage, filters.replace("page=1", "page=2"))).coverage).toEqual(baseline.coverage);

  const school = await progress(holisticAdminPage, schoolFilters);
  const unassigned = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  for (const [progressQuery, rosterQuery] of [
    ["&grade=11", "&grade=11"],
    ["&grade=12", "&grade=12"],
    [`&search=${unassigned.externalStudentId}`, `&search=${unassigned.externalStudentId}`],
  ]) {
    const filtered = await progress(holisticAdminPage, `${schoolFilters}${progressQuery}`);
    expect(filtered.coverage, progressQuery).not.toEqual(school.coverage);
    expect(filtered.coverage, progressQuery).toEqual(
      await rosterCoverage(holisticTeacherPage, schoolCode, rosterQuery),
    );
  }
  const searched = await progress(holisticAdminPage, `${schoolFilters}&search=${unassigned.externalStudentId}`);
  expect(searched.coverage.unassigned).toBeGreaterThanOrEqual(1);
});

test("coverage is unavailable under a Mentor filter and for past Academic Years", async ({ holisticAdminPage }) => {
  const baseline = await progress(holisticAdminPage, filters);
  const mentorUserId = baseline.options.mentors[0].userId;

  const mentor = await progress(holisticAdminPage, `${filters}&mentor_user_id=${mentorUserId}`);
  expect(mentor.coverage).toBeNull();
  expect(mentor.counts.total).toBeGreaterThan(0);
  const pastYear = await progress(holisticAdminPage, "academic_year=2025-2026&program_id=1");
  expect(pastYear.coverage).toBeNull();
  expect(Array.isArray(pastYear.rows)).toBe(true);
});

test("coverage excludes a dropout Unassigned Student and stays equal to the Teacher roster", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const schoolFilters = `${filters}&school_code=${schoolCode}`;
  const unassigned = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  const before = (await progress(holisticAdminPage, schoolFilters)).coverage;
  const pool = getTestPool();
  const original = await pool.query<{ status: string | null }>(
    "SELECT status FROM student WHERE id = $1", [unassigned.studentId],
  );
  try {
    await pool.query("UPDATE student SET status = 'dropout' WHERE id = $1", [unassigned.studentId]);
    const after = (await progress(holisticAdminPage, schoolFilters)).coverage;
    expect(after).toEqual({
      eligible: before.eligible - 1,
      assigned: before.assigned,
      unassigned: before.unassigned - 1,
    });
    expect(after).toEqual(await rosterCoverage(holisticTeacherPage, schoolCode));
  } finally {
    await pool.query("UPDATE student SET status = $2 WHERE id = $1", [unassigned.studentId, original.rows[0].status]);
    await pool.end();
  }
  expect((await progress(holisticAdminPage, schoolFilters)).coverage).toEqual(before);
});

test("coverage excludes an Unassigned Student with conflicting roster Grades", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const schoolFilters = `${filters}&school_code=${schoolCode}`;
  const unassigned = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  const before = (await progress(holisticAdminPage, schoolFilters)).coverage;
  const pool = getTestPool();
  let conflictingEnrollmentId: number | null = null;
  try {
    // A second current Grade 12 enrollment gives the Student two roster Grades in centre_students.
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO enrollment_record
         (user_id, group_id, group_type, academic_year, is_current, inserted_at, updated_at)
       SELECT student.user_id, (SELECT id FROM grade WHERE number = 12 ORDER BY id LIMIT 1),
              'grade', '2026-2027', true, now(), now()
       FROM student WHERE student.id = $1
       RETURNING id`,
      [unassigned.studentId],
    );
    conflictingEnrollmentId = Number(inserted.rows[0].id);
    const after = (await progress(holisticAdminPage, schoolFilters)).coverage;
    expect(after).toEqual({
      eligible: before.eligible - 1,
      assigned: before.assigned,
      unassigned: before.unassigned - 1,
    });
    expect(after).toEqual(await rosterCoverage(holisticTeacherPage, schoolCode));
  } finally {
    if (conflictingEnrollmentId !== null) {
      await pool.query("DELETE FROM enrollment_record WHERE id = $1", [conflictingEnrollmentId]);
    }
    await pool.end();
  }
  expect((await progress(holisticAdminPage, schoolFilters)).coverage).toEqual(before);
});

// Inactive Centres are not seeded here. centre_students lists a School's Students
// under every active Centre of that School, so deactivating the fixture Centre
// removes the whole School roster. Reconciliation would then end every fixture
// Mapping and erase draft answers, which cannot be restored exactly. Coverage and
// the Teacher roster both join only active Centres; the parity tests cover that rule.

test("a School whose Mappings all end leaves the School options and coverage but keeps Assignment Coverage", async ({
  holisticAdminPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const schoolFilters = `${filters}&school_code=${schoolCode}`;
  const programBefore = await progress(holisticAdminPage, filters);
  const schoolBefore = (await progress(holisticAdminPage, schoolFilters)).coverage;
  expect(programBefore.options.schools.map(({ code }: { code: string }) => code)).toContain(schoolCode);
  expect(schoolBefore.assigned).toBeGreaterThan(0);
  const pool = getTestPool();
  let ended: Array<{ id: string; updated_at: Date }> = [];
  try {
    const result = await pool.query<{ id: string; updated_at: Date }>(
      `WITH active AS (
         SELECT mapping.id, mapping.updated_at
         FROM holistic_mentorship_mentor_mentee_mappings mapping
         JOIN school ON school.id = mapping.school_id
         WHERE school.code = $1 AND mapping.program_id = 1
           AND mapping.academic_year = '2026-2027' AND mapping.ended_at IS NULL
       ), ended AS (
         UPDATE holistic_mentorship_mentor_mentee_mappings mapping
         SET ended_at = GREATEST(now(), mapping.started_at), end_source = 'e2e_temporary',
             end_reason = 'e2e_zero_mentee_school'
         FROM active WHERE mapping.id = active.id
         RETURNING mapping.id
       )
       SELECT active.id, active.updated_at FROM active JOIN ended ON ended.id = active.id`,
      [schoolCode],
    );
    ended = result.rows;
    expect(ended.length).toBeGreaterThan(0);

    const school = await progress(holisticAdminPage, schoolFilters);
    expect(school.coverage).toEqual({ eligible: 0, assigned: 0, unassigned: 0 });
    const program = await progress(holisticAdminPage, filters);
    expect(program.options.schools.map(({ code }: { code: string }) => code)).not.toContain(schoolCode);
    expect(program.coverageSchools.map(({ code }: { code: string }) => code)).toContain(schoolCode);
    expect(program.coverage).toEqual({
      eligible: programBefore.coverage.eligible - schoolBefore.eligible,
      assigned: programBefore.coverage.assigned - schoolBefore.assigned,
      unassigned: programBefore.coverage.unassigned - schoolBefore.unassigned,
    });
  } finally {
    for (const mapping of ended) {
      await pool.query(
        `UPDATE holistic_mentorship_mentor_mentee_mappings
         SET ended_at = NULL, end_source = NULL, end_reason = NULL, updated_at = $2
         WHERE id = $1`,
        [mapping.id, mapping.updated_at],
      );
    }
    await pool.end();
  }
  expect((await progress(holisticAdminPage, schoolFilters)).coverage).toEqual(schoolBefore);
});

test("program coverage equals the sum over the selectable Schools", async ({ holisticAdminPage }) => {
  const program = await progress(holisticAdminPage, filters);
  expect(program.options.schools.length).toBeGreaterThan(0);
  const total = { eligible: 0, assigned: 0, unassigned: 0 };
  for (const { code } of program.options.schools as Array<{ code: string }>) {
    const { coverage } = await progress(holisticAdminPage, `${filters}&school_code=${code}`);
    total.eligible += coverage.eligible;
    total.assigned += coverage.assigned;
    total.unassigned += coverage.unassigned;
  }
  expect(total).toEqual(program.coverage);
});

test("Holistic PM and PA see the Admin's coverage for an in-scope School only", async ({
  holisticAdminPage,
  holisticPmPage,
  holisticProgramAdminPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const schoolFilters = `${filters}&school_code=${schoolCode}`;
  const admin = (await progress(holisticAdminPage, schoolFilters)).coverage;
  const pool = getTestPool();
  let outOfScopeCode: string;
  try {
    const result = await pool.query<{ code: string }>(
      `SELECT other.code FROM school fixture
       JOIN school other ON other.id <> fixture.id
        AND COALESCE(other.region, '') <> COALESCE(fixture.region, '')
       JOIN centres centre ON centre.school_id = other.id AND centre.program_id = 1 AND centre.is_active IS TRUE
       WHERE fixture.code = $1 ORDER BY other.code LIMIT 1`,
      [schoolCode],
    );
    outOfScopeCode = result.rows[0].code;
  } finally {
    await pool.end();
  }
  for (const page of [holisticPmPage, holisticProgramAdminPage]) {
    expect((await progress(page, schoolFilters)).coverage).toEqual(admin);
    const denied = await page.request.get(`${endpoint}?${filters}&school_code=${outOfScopeCode}`);
    expect(denied.status()).toBe(403);
  }
});

test("progress counts, filters, pagination and CSV work with the production Centre membership view", async ({ holisticAdminPage }) => {
  const response = await holisticAdminPage.request.get(`${endpoint}?${filters}`);
  expect(response.status()).toBe(200);
  const baseline = await response.json();
  expect(baseline.rows.length).toBeGreaterThan(0);
  expect(baseline.counts.total).toBe(
    baseline.counts.pending + baseline.counts.completed + baseline.counts.skipped + baseline.counts.noActivePhase,
  );
  const first = baseline.rows[0];
  for (const [filter, key, value] of [
    ["school_code", "schoolCode", first.schoolCode],
    ["grade", "grade", first.grade],
    ["progress", "progress", first.progress],
  ]) {
    const filteredResponse = await holisticAdminPage.request.get(`${endpoint}?${filters}&${filter}=${value}`);
    expect(filteredResponse.status()).toBe(200);
    const filtered = await filteredResponse.json();
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows.every((row: Record<string, unknown>) => row[key] === value)).toBe(true);
    expect(filtered.counts.total).toBeLessThanOrEqual(baseline.counts.total);
  }
  const pageTwoResponse = await holisticAdminPage.request.get(`${endpoint}?${filters.replace("page=1", "page=2")}`);
  expect(pageTwoResponse.status()).toBe(200);
  const pageTwo = await pageTwoResponse.json();
  expect(pageTwo.counts).toEqual(baseline.counts);
  expect(pageTwo.rows.every((row: { studentId: number }) =>
    !baseline.rows.some((original: { studentId: number }) => original.studentId === row.studentId),
  )).toBe(true);
  const csv = await holisticAdminPage.request.get(`${endpoint}?${filters}&format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(first.externalStudentId);

  for (const query of [
    "academic_year=2025-2026&program_id=1",
    "academic_year=2026-2027&program_id=78",
  ]) {
    const other = await holisticAdminPage.request.get(`${endpoint}?${query}`);
    expect(other.status()).toBe(200);
    expect(Array.isArray((await other.json()).rows)).toBe(true);
  }
});

test("progress shows a useful empty-500 error and Refresh restores the real results", async ({ holisticAdminPage }) => {
  await holisticAdminPage.route(`**${endpoint}?**`, (route) => route.fulfill({ status: 500, body: "" }));
  await holisticAdminPage.goto("/admin/holistic-mentorship");
  await expect(holisticAdminPage.getByRole("alert").filter({ hasText: "Unable to load progress" })).toHaveText("Unable to load progress. Please try again.");
  await holisticAdminPage.unroute(`**${endpoint}?**`);
  await holisticAdminPage.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(holisticAdminPage.getByRole("alert").filter({ hasText: "Unable to load progress" })).toHaveCount(0);
  await expect(holisticAdminPage.getByRole("table", { name: "Student progress results" }).locator("tbody tr").first()).toBeVisible();
  await expect(holisticAdminPage.getByText(/Last refreshed/)).toBeVisible();
});

test("Coverage and Progress cards fit every Holistic viewport without page overflow", async ({ holisticAdminPage }) => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await holisticAdminPage.setViewportSize(viewport);
    await holisticAdminPage.goto("/admin/holistic-mentorship");
    const coverage = holisticAdminPage.getByRole("region", { name: "Coverage" });
    await expect(coverage.getByText("Eligible Students", { exact: true })).toBeVisible();
    await expect(coverage.getByText("Unassigned", { exact: true })).toBeVisible();
    await expect(coverage.locator("li").first().locator("p").last()).toHaveText(/^\d+$/);
    await expect(holisticAdminPage.getByRole("region", { name: "Progress" }).getByText("Completed", { exact: true }))
      .toBeVisible();
    const horizontalPageScroll = await holisticAdminPage.evaluate(() => {
      const original = { x: window.scrollX, y: window.scrollY };
      window.scrollTo(document.documentElement.scrollWidth, original.y);
      const scrolled = window.scrollX;
      window.scrollTo(original.x, original.y);
      return scrolled;
    });
    expect(horizontalPageScroll, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
  }
});
