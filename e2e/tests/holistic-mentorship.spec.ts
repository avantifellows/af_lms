import { expect, test } from "../fixtures/auth";

test.describe("Holistic Mentorship access shell", () => {
  test("Admin workspace remains usable on desktop and narrow screens", async ({
    adminPage,
  }) => {
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
      expect(
        await adminPage.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        )
      ).toBe(true);
    }
  });

  test("excluded roles cannot open the Admin workspace", async ({ pmPage }) => {
    await pmPage.goto("/admin/holistic-mentorship");
    await expect(
      pmPage.getByRole("heading", { name: "Holistic Mentorship" })
    ).not.toBeVisible();
  });
});
