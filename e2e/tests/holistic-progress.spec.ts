import { expect, test } from "../fixtures/auth";

const endpoint = "/api/holistic-mentorship/progress";
const filters = "academic_year=2026-2027&program_id=1&page=1&sort=school&direction=asc";

test("progress counts, filters, pagination and CSV work with the production Centre membership view", async ({ holisticAdminPage }) => {
  const response = await holisticAdminPage.request.get(`${endpoint}?${filters}`);
  expect(response.status()).toBe(200);
  const baseline = await response.json();
  expect(baseline.rows.length).toBeGreaterThan(0);
  expect(baseline.counts.totalMapped).toBe(
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
    expect(filtered.counts.totalMapped).toBeLessThanOrEqual(baseline.counts.totalMapped);
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
