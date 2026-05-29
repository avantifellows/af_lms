import { test, expect } from "../fixtures/auth";

test.describe("Curriculum read path", () => {
  test("admin can select Program, Exam Track, Biology, and sees configured chapter ordering", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000075?tab=curriculum");

    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();

    await expect(adminPage.getByLabel("Program")).toBeVisible();
    await expect(adminPage.getByLabel("Exam Track").locator("option")).toHaveText([
      "JEE Main",
      "JEE Advanced",
      "NEET",
    ]);
    await expect(adminPage.getByText("1. Fixture Alpha Physics")).toBeVisible();
    await expect(adminPage.getByText("2. Fixture Beta Physics")).toBeVisible();
    await expect(adminPage.getByText(/Prescribed: 1h 30m/)).toBeVisible();

    await adminPage.getByLabel("Exam Track").selectOption("neet");

    await expect(adminPage.getByLabel("Grade")).toHaveValue("12");
    await expect(adminPage.getByLabel("Subject")).toHaveValue("Biology");
    await expect(
      adminPage.getByRole("heading", { name: "NEET Curriculum Progress" })
    ).toBeVisible();
    await expect(adminPage.getByText("1. Fixture Biology")).toBeVisible();
  });

  test("admin sees an empty Curriculum state for an NVS-only school", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000076?tab=curriculum");

    await expect(
      adminPage.getByText("No curriculum-enabled Programs are available for this school.")
    ).toBeVisible();
  });
});
