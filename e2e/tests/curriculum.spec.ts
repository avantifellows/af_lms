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

  test("admin can mark and unmark Chapter Completion from a chapter row across reloads", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000075?tab=curriculum");
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();

    const alphaRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Alpha Physics" });

    await alphaRow.getByRole("button", { name: "Mark complete" }).click();
    await expect(
      alphaRow.getByRole("button", { name: "Unmark complete" })
    ).toBeVisible();

    await adminPage.reload();
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await expect(
      alphaRow.getByRole("button", { name: "Unmark complete" })
    ).toBeVisible();

    await alphaRow.getByRole("button", { name: "Unmark complete" }).click();
    await expect(
      alphaRow.getByRole("button", { name: "Mark complete" })
    ).toBeVisible();

    await adminPage.reload();
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await expect(
      alphaRow.getByRole("button", { name: "Mark complete" })
    ).toBeVisible();
  });

  test("admin can save completion-only and mixed Add Log changes", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000075?tab=curriculum");
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();

    await adminPage.getByRole("button", { name: "+ Add Log" }).click();
    await expect(adminPage.getByText("Log Teaching Session")).toBeVisible();
    const alphaRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Alpha Physics" });
    await alphaRow.getByRole("checkbox", { name: "Complete" }).check();
    await adminPage.getByRole("button", { name: "Save Log" }).click();

    await expect(adminPage.getByText("Log Teaching Session")).toBeHidden();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    await expect(adminPage.getByText("No LMS Curriculum Logs yet.")).toBeVisible();

    await adminPage.getByRole("button", { name: "+ Add Log" }).click();
    const betaRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Beta Physics" });
    await betaRow.getByRole("checkbox", { name: "Complete" }).check();
    await betaRow.getByText("Fixture Beta Physics").click();
    await adminPage.getByRole("checkbox", { name: /Beta Forces/ }).check();
    await adminPage.getByRole("button", { name: "Save Log" }).click();

    await expect(adminPage.getByText("Log Teaching Session")).toBeHidden();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    await expect(adminPage.getByText("Beta Forces")).toBeVisible();

    await adminPage.getByRole("button", { name: "Edit log" }).click();
    await expect(adminPage.getByText("Log Teaching Session")).toBeVisible();
    await expect(adminPage.getByRole("checkbox", { name: "Complete" })).toBeHidden();

    await adminPage.getByRole("checkbox", { name: /Beta Forces/ }).uncheck();
    const alphaEditRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Alpha Physics" });
    await alphaEditRow.getByText("Fixture Alpha Physics").click();
    await adminPage.getByRole("checkbox", { name: /Alpha Motion/ }).check();
    await adminPage.getByRole("button", { name: "Save Changes" }).click();

    await expect(adminPage.getByText("Log Teaching Session")).toBeHidden();
    await expect(adminPage.getByText("Alpha Motion")).toBeVisible();
    await expect(adminPage.getByText("Beta Forces")).toBeHidden();

    await adminPage.reload();
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await adminPage.getByRole("button", { name: "Chapters" }).click();
    await alphaEditRow.getByText("Fixture Alpha Physics").click();
    await expect(alphaEditRow.getByText("1/1")).toBeVisible();
    await expect(alphaEditRow.getByText(/Time: 1h/)).toBeVisible();
  });
});
