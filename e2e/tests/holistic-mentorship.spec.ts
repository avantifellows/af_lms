import { expect, test } from "../fixtures/auth";

test.describe("Holistic Mentorship access shell", () => {
  test("Admin workspace remains usable on desktop and narrow screens", async ({
    adminPage,
  }) => {
    await adminPage.route("**/api/holistic-mentorship/progress?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          rows: [],
          counts: { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
          options: { schools: [], mentors: [], phases: [] },
          refreshedAt: "2026-07-17T10:00:00.000Z",
          pageSize: 50,
        }),
      })
    );
    for (const width of [1280, 375]) {
      await adminPage.setViewportSize({ width, height: 800 });
      await adminPage.goto("/admin/holistic-mentorship");

      await expect(
        adminPage.getByRole("heading", { name: "Holistic Mentorship" })
      ).toBeVisible();
      await expect(
        adminPage.getByRole("tab", { name: "Students & Progress" })
      ).toBeVisible();
      await expect(
        adminPage.getByRole("tab", { name: "Phase Setup" })
      ).toBeVisible();
      if (width === 375) {
        const results = adminPage.getByLabel("Student progress results");
        const box = await results.boundingBox();
        expect(box && box.x + box.width).toBeLessThanOrEqual(width);
        expect(await results.evaluate((element) => {
          element.scrollLeft = 100;
          return element.scrollLeft;
        })).toBeGreaterThan(0);
      }
    }
  });

  test("excluded roles cannot open the Admin workspace", async ({ pmPage }) => {
    await pmPage.goto("/admin/holistic-mentorship");
    await expect(
      pmPage.getByRole("heading", { name: "Holistic Mentorship" })
    ).not.toBeVisible();
  });
});
