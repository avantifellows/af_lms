import { test, expect } from "../fixtures/auth";

test.describe("Curriculum read path", () => {
  test("admin can open read-only Curriculum Config while summary users do not see the entry point", async ({
    adminPage,
    pmPage,
    programAdminPage,
  }) => {
    await adminPage.goto("/curriculum-summary");
    await expect(
      adminPage.getByRole("link", { name: "Manage config" })
    ).toBeVisible();

    await adminPage.getByRole("link", { name: "Manage config" }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Curriculum Config", exact: true })
    ).toBeVisible();
    await expect(adminPage.getByLabel("Exam Track")).toHaveValue("jee_main");
    await expect(adminPage.getByLabel("Syllabus status")).toHaveValue(
      "in_syllabus"
    );
    await expect(adminPage.getByText("Fixture Alpha Physics")).toBeVisible();
    await expect(adminPage.getByText("Fixture Beta Physics")).toBeVisible();

    await pmPage.goto("/curriculum-summary");
    await expect(
      pmPage.getByRole("link", { name: "Manage config" })
    ).toBeHidden();

    await programAdminPage.goto("/curriculum-summary");
    await expect(
      programAdminPage.getByRole("link", { name: "Manage config" })
    ).toBeHidden();
  });

  test("admin sees Curriculum Summary metrics for logged and zero-progress expected rows", async ({
    adminPage,
  }) => {
    await adminPage.goto(
      "/curriculum-summary?schools=LMS75&programs=2&grades=11&subjects=4&exam_tracks=jee_main,jee_advanced"
    );

    await expect(
      adminPage.getByRole("heading", { name: "Curriculum Summary", exact: true })
    ).toBeVisible();
    await expect(adminPage.getByText("Top-level Actual Hours use raw LMS Curriculum Log duration")).toBeVisible();

    const loggedRow = adminPage
      .getByRole("row")
      .filter({ hasText: "JNV Nodal" })
      .filter({ hasText: "JEE Main" });
    await expect(loggedRow).toContainText("1/2 (50%)");
    await expect(loggedRow).toContainText("2/2 (100%)");
    await expect(loggedRow).toContainText("-57.1%");
    await expect(loggedRow).toContainText("1h 30m / 3h 30m");
    await expect(loggedRow).toContainText("Under prescribed hours");

    const zeroProgressRow = adminPage
      .getByRole("row")
      .filter({ hasText: "JNV Nodal" })
      .filter({ hasText: "JEE Advanced" });
    await expect(zeroProgressRow).toContainText("0/1 (0%)");
    await expect(zeroProgressRow).toContainText("1/1 (100%)");
    await expect(zeroProgressRow).toContainText("0h / 2h 30m");
  });

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

  test("admin sees Curriculum for a school without relying on school program_id", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000076?tab=curriculum");

    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await expect(adminPage.getByLabel("Program")).toHaveValue("1");
    await expect(adminPage.getByText("Fixture Alpha Physics")).toBeVisible();
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
    await adminPage.getByLabel("Program").selectOption("2");

    await adminPage.getByRole("button", { name: "+ Add Log" }).click();
    await expect(adminPage.getByText("Log Teaching Session")).toBeVisible();
    const betaCompletionRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Beta Physics" });
    await betaCompletionRow.getByRole("checkbox", { name: "Complete" }).check();
    await adminPage.getByRole("button", { name: "Save Log" }).click();

    await expect(adminPage.getByText("Log Teaching Session")).toBeHidden();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    await expect(adminPage.getByText("No LMS Curriculum Logs yet.")).toBeVisible();

    await adminPage.getByRole("button", { name: "+ Add Log" }).click();
    const betaRow = adminPage
      .locator(".fixed [data-chapter-row]")
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
    await adminPage.getByLabel("Program").selectOption("2");
    await adminPage.getByRole("button", { name: "Chapters" }).click();
    await alphaEditRow.getByText("Fixture Alpha Physics").click();
    await expect(alphaEditRow.getByText("1/1")).toBeVisible();
    await expect(alphaEditRow.getByText(/Time: 1h/)).toBeVisible();
  });

  test("admin can delete a log and it stays excluded after reload", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000075?tab=curriculum");
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await adminPage.getByLabel("Program").selectOption("2");

    await adminPage.getByRole("button", { name: "+ Add Log" }).click();
    const betaRow = adminPage
      .locator(".fixed [data-chapter-row]")
      .filter({ hasText: "Fixture Beta Physics" });
    await betaRow.getByRole("button").first().click();
    await adminPage.getByRole("checkbox", { name: /Beta Forces/ }).check();
    await adminPage.getByRole("button", { name: "Save Log" }).click();

    await expect(adminPage.getByText("Log Teaching Session")).toBeHidden();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    await expect(adminPage.getByText("Beta Forces")).toBeVisible();

    const betaLog = adminPage
      .locator("[data-curriculum-log-row]")
      .filter({ hasText: "Beta Forces" });
    adminPage.once("dialog", (dialog) => dialog.accept());
    await betaLog.getByRole("button", { name: "Delete log" }).click();
    await expect(adminPage.getByText("Beta Forces")).toBeHidden();

    await adminPage.reload();
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    await expect(adminPage.getByText("Beta Forces")).toBeHidden();
  });
});
