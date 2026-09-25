import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

const endpoint = "/api/holistic-mentorship/progress";
const filters = "academic_year=2026-2027&program_id=1&page=1&sort=school&direction=asc";

type Coverage = { eligible: number; assigned: number; unassigned: number };
type RosterStudent = {
  studentId: number;
  externalStudentId: string | null;
  grade: number;
  activePhaseId: number | null;
  ownership: unknown;
};
type UnassignedRow = { progress: string; studentId: number; schoolCode: string; activePhaseId: number | null };

const unassignedFilters = `${filters}&progress=unassigned`;
const csvHeaderPattern = new RegExp(
  "^Academic Year,Program ID,Program Name,School,UDISE Code,Student Name,Student External ID," +
  "Grade,Mentor Name,Mentor Email,Phase,Phase Title,Availability,Progress,Completed At," +
  "(Question (\\d+),Answer \\2,)*Notes Author Name,Notes Author Email,Notes Last Edited At$",
);

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

async function allUnassignedRows(page: Page, query: string): Promise<UnassignedRow[]> {
  const rows: UnassignedRow[] = [];
  for (let pageNumber = 1; ; pageNumber += 1) {
    const body = await progress(page, query.replace("page=1", `page=${pageNumber}`));
    rows.push(...body.rows);
    if (rows.length >= body.counts.total || body.rows.length === 0) return rows;
  }
}

async function unownedStudentIds(page: Page, schoolCode: string, query = "") {
  return (await rosterStudents(page, schoolCode, query))
    .filter(({ ownership }) => ownership === null)
    .map(({ studentId }) => studentId)
    .sort((left, right) => left - right);
}

// Minimal RFC 4180 reader: quoted cells may hold commas, quotes and line breaks.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\r" && text[index + 1] === "\n") {
      row.push(cell); rows.push(row); row = []; cell = ""; index += 1;
    } else cell += character;
  }
  row.push(cell);
  rows.push(row);
  return rows;
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

test("School coverage matches the Teacher roster, ignores Phase, Progress, page and sort, and follows Grade and search", async ({
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
  expect(school.coverage).toEqual(await rosterCoverage(holisticTeacherPage, schoolCode));
  expect(school.coverage.unassigned).toBeGreaterThan(0);
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

test("coverage excludes dropout and conflicting-Grade Students and stays equal to the Teacher roster", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  test.setTimeout(60_000);
  const schoolCode = await fixtureSchoolCode();
  const schoolFilters = `${filters}&school_code=${schoolCode}`;
  const unassigned = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  const before = (await progress(holisticAdminPage, schoolFilters)).coverage;
  const expectOneFewerUnassigned = async () => {
    const after = (await progress(holisticAdminPage, schoolFilters)).coverage;
    expect(after).toEqual({
      eligible: before.eligible - 1,
      assigned: before.assigned,
      unassigned: before.unassigned - 1,
    });
    expect(after).toEqual(await rosterCoverage(holisticTeacherPage, schoolCode));
  };
  const pool = getTestPool();
  try {
    await test.step("dropout", async () => {
      const original = await pool.query<{ status: string | null }>(
        "SELECT status FROM student WHERE id = $1", [unassigned.studentId],
      );
      try {
        await pool.query("UPDATE student SET status = 'dropout' WHERE id = $1", [unassigned.studentId]);
        await expectOneFewerUnassigned();
      } finally {
        await pool.query("UPDATE student SET status = $2 WHERE id = $1", [unassigned.studentId, original.rows[0].status]);
      }
      expect((await progress(holisticAdminPage, schoolFilters)).coverage).toEqual(before);
    });

    await test.step("conflicting roster Grades", async () => {
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
        await expectOneFewerUnassigned();
      } finally {
        if (conflictingEnrollmentId !== null) {
          await pool.query("DELETE FROM enrollment_record WHERE id = $1", [conflictingEnrollmentId]);
        }
      }
      expect((await progress(holisticAdminPage, schoolFilters)).coverage).toEqual(before);
    });
  } finally {
    await pool.end();
  }
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

test("program coverage adds up, equals assigned progress and sums over the selectable Schools", async ({
  holisticAdminPage,
}) => {
  test.setTimeout(60_000);
  const program = await progress(holisticAdminPage, filters);
  expect(program.coverage.eligible).toBeGreaterThan(0);
  expect(program.coverage.eligible).toBe(program.coverage.assigned + program.coverage.unassigned);
  expect(program.coverage.assigned).toBe(program.counts.total);
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

test("Holistic PM and PA see the Admin's coverage and Unassigned Students for in-scope Schools only", async ({
  holisticAdminPage,
  holisticPmPage,
  holisticProgramAdminPage,
}) => {
  test.setTimeout(60_000);
  const schoolCode = await fixtureSchoolCode();
  const schoolFilters = `${unassignedFilters}&school_code=${schoolCode}`;
  const admin = await progress(holisticAdminPage, schoolFilters);
  expect(admin.counts.total).toBeGreaterThan(0);
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
    const scoped = await progress(page, schoolFilters);
    expect(scoped.coverage).toEqual(admin.coverage);
    expect(scoped.counts.total).toBe(admin.counts.total);
    expect(scoped.rows).toEqual(admin.rows);
    const programWide = await progress(page, unassignedFilters);
    const inScope = new Set(programWide.coverageSchools.map(({ code }: { code: string }) => code));
    expect(programWide.rows.every((row: UnassignedRow) => inScope.has(row.schoolCode))).toBe(true);
    expect(programWide.rows.some((row: UnassignedRow) => row.schoolCode === outOfScopeCode)).toBe(false);
    const denied = await page.request.get(`${endpoint}?${unassignedFilters}&school_code=${outOfScopeCode}`);
    expect(denied.status()).toBe(403);
  }
});

test("the Unassigned list holds only Unassigned rows, pages at 50 and totals the Unassigned coverage", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const known = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  expect(known.activePhaseId, "the fixture Grade 11 has an active Phase").not.toBeNull();
  const list = await progress(holisticAdminPage, unassignedFilters);

  expect(list.counts).toEqual({
    total: list.coverage.unassigned, pending: 0, completed: 0, skipped: 0, noActivePhase: 0,
  });
  expect(list.counts.total).toBeGreaterThan(0);
  expect(list.rows.length).toBe(Math.min(50, list.counts.total));
  expect(list.rows.every((row: UnassignedRow) => row.progress === "unassigned")).toBe(true);
  const pageTwo = await progress(holisticAdminPage, unassignedFilters.replace("page=1", "page=2"));
  const pageOneKeys = new Set(list.rows.map((row: UnassignedRow) => `${row.schoolCode}:${row.studentId}`));
  expect(pageTwo.rows.some((row: UnassignedRow) => pageOneKeys.has(`${row.schoolCode}:${row.studentId}`))).toBe(false);
  expect(pageTwo.counts).toEqual(list.counts);

  const school = await progress(holisticAdminPage, `${unassignedFilters}&school_code=${schoolCode}`);
  expect(school.rows.find((row: UnassignedRow) => row.studentId === known.studentId)).toMatchObject({
    progress: "unassigned", schoolCode, grade: 11, activePhaseId: known.activePhaseId,
    externalStudentId: known.externalStudentId,
  });
});

test("a Phase limits the Unassigned list to its Grade while coverage ignores it", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const known = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  const schoolFilters = `${unassignedFilters}&school_code=${schoolCode}`;
  const baseline = await progress(holisticAdminPage, schoolFilters);
  const grade12Phase = baseline.options.phases.find(({ grade }: { grade: number }) => grade === 12);
  expect(grade12Phase, "the fixture Plan has a Grade 12 Phase").toBeDefined();

  const grade12 = await progress(holisticAdminPage, `${schoolFilters}&phase_id=${grade12Phase.id}`);
  expect(grade12.rows.some((row: UnassignedRow) => row.studentId === known.studentId)).toBe(false);
  expect(grade12.rows.every((row: { grade: number }) => row.grade === 12)).toBe(true);
  expect(grade12.coverage).toEqual(baseline.coverage);

  const unknown = await progress(holisticAdminPage, `${schoolFilters}&phase_id=2147483646`);
  expect(unknown.rows).toEqual([]);
  expect(unknown.counts.total).toBe(0);
  expect(unknown.coverage).toEqual(baseline.coverage);
});

test("the fixture School's Unassigned list matches the Teacher roster's unowned Students", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const known = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  const schoolFilters = `${unassignedFilters}&school_code=${schoolCode}`;
  const listIds = async (extra: string) => (await allUnassignedRows(holisticAdminPage, `${schoolFilters}${extra}`))
    .map(({ studentId }) => studentId)
    .sort((left, right) => left - right);

  const all = await listIds("");
  expect(all).toEqual(await unownedStudentIds(holisticTeacherPage, schoolCode));
  expect(all).toContain(known.studentId);
  for (const extra of ["&grade=11", "&grade=12", `&search=${known.externalStudentId}`]) {
    const narrowed = await listIds(extra);
    expect(narrowed, extra).toEqual(await unownedStudentIds(holisticTeacherPage, schoolCode, extra));
    expect(narrowed.length, extra).toBeLessThanOrEqual(all.length);
  }
});

test("Unassigned is rejected for a past Academic Year or with a Mentor", async ({ holisticAdminPage }) => {
  const baseline = await progress(holisticAdminPage, filters);
  const mentorUserId = baseline.options.mentors[0].userId;
  for (const query of [
    `${unassignedFilters}&mentor_user_id=${mentorUserId}`,
    "academic_year=2025-2026&program_id=1&progress=unassigned",
    "academic_year=2025-2026&program_id=1&progress=unassigned&format=csv",
  ]) {
    const response = await holisticAdminPage.request.get(`${endpoint}?${query}`);
    expect(response.status(), query).toBe(422);
    expect(await response.json(), query).toEqual({ error: "Invalid progress filters" });
  }
});

test("the Unassigned CSV lists Unassigned Students only and the All Assigned CSV is unchanged", async ({
  holisticAdminPage,
  holisticTeacherPage,
}) => {
  const schoolCode = await fixtureSchoolCode();
  const known = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  const owned = (await rosterStudents(holisticTeacherPage, schoolCode)).filter(({ ownership }) => ownership !== null);
  expect(owned.length).toBeGreaterThan(0);

  const unassignedCsv = await holisticAdminPage.request.get(
    `${endpoint}?${unassignedFilters}&school_code=${schoolCode}&format=csv`,
  );
  expect(unassignedCsv.status()).toBe(200);
  const [header, ...rows] = parseCsv(await unassignedCsv.text());
  expect(header.join(",")).toMatch(csvHeaderPattern);
  expect(header).not.toContain("Question 1");
  const column = (name: string) => header.indexOf(name);
  const knownRow = rows.find((row) => row[column("Student External ID")] === known.externalStudentId);
  expect(knownRow).toBeDefined();
  expect(knownRow![column("Progress")]).toBe("unassigned");
  for (const blank of [
    "Mentor Name", "Mentor Email", "Phase", "Phase Title", "Availability", "Completed At",
    "Notes Author Name", "Notes Author Email", "Notes Last Edited At",
  ]) {
    expect(knownRow![column(blank)], blank).toBe("");
  }
  expect(rows.every((row) => row[column("Progress")] === "unassigned")).toBe(true);
  const exportedIds = new Set(rows.map((row) => row[column("Student External ID")]));
  for (const mentee of owned) expect(exportedIds.has(mentee.externalStudentId!)).toBe(false);

  const assigned = await progress(holisticAdminPage, filters);
  const assignedCsv = await holisticAdminPage.request.get(`${endpoint}?${filters}&format=csv`);
  expect(assignedCsv.status()).toBe(200);
  const [assignedHeader, ...assignedRows] = parseCsv(await assignedCsv.text());
  expect(assignedHeader.join(",")).toMatch(csvHeaderPattern);
  expect(assignedRows.length).toBe(assigned.counts.total);
  const progressColumn = assignedHeader.indexOf("Progress");
  expect(assignedRows.some((row) => row[progressColumn] === "unassigned")).toBe(false);
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

test("header Back from an Unassigned Student returns to Students & Progress with Unassigned still selected", async ({
  holisticAdminPage: page,
  holisticTeacherPage,
}) => {
  test.setTimeout(60_000);
  const schoolCode = await fixtureSchoolCode();
  const known = await knownUnassignedGrade11Student(holisticTeacherPage, schoolCode);
  const unassignedBody = await progress(page, `${unassignedFilters}&school_code=${schoolCode}`);
  const knownRow = unassignedBody.rows.find((row: UnassignedRow) => row.studentId === known.studentId);
  expect(knownRow, "the known Unassigned Student is on the first Unassigned page").toBeDefined();
  const studentName: string = knownRow.studentName;

  await page.goto("/admin/holistic-mentorship?program_id=1");
  const coverage = page.getByRole("region", { name: "Coverage" });
  for (const label of ["Eligible Students", "Assigned", "Unassigned"]) {
    await expect(coverage.getByText(label, { exact: true })).toBeVisible();
  }
  const table = page.getByRole("table", { name: "Student progress results" });
  await expect(table.locator("tbody tr").first()).toBeVisible();

  const progressFilter = page.getByLabel("Filter by Progress");
  await progressFilter.selectOption("unassigned");
  await expect(table.locator("tbody tr").first().getByText("Unassigned", { exact: true })).toBeVisible();
  await page.getByLabel("Search Students").fill(studentName);
  const knownStudentRow = table.getByRole("row").filter({ hasText: studentName });
  await expect(knownStudentRow.first()).toBeVisible();

  await knownStudentRow.first().getByRole("link", { name: `Open ${studentName}` }).click();
  await expect(page).toHaveURL(new RegExp(
    `/holistic-mentorship/students/${known.studentId}/phases/${known.activePhaseId}\\?.*source=progress`,
  ));

  await page.getByRole("link", { name: "Back to Students and Progress" }).click();
  await expect(page).toHaveURL(/\/admin\/holistic-mentorship\?program_id=1$/);
  await expect(page.getByLabel("Filter by Progress")).toHaveValue("unassigned");
  await expect(table.getByRole("row").filter({ hasText: studentName }).first()
    .getByText("Unassigned", { exact: true })).toBeVisible();
});
