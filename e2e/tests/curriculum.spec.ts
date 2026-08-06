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
    ]);
    await expect(adminPage.getByText("1. Fixture Alpha Physics")).toBeVisible();
    await expect(adminPage.getByText("2. Fixture Beta Physics")).toBeVisible();
    await expect(adminPage.getByText(/Prescribed: 1h 30m/)).toBeVisible();

    await adminPage.getByLabel("Grade").selectOption("12");

    await expect(adminPage.getByLabel("Grade")).toHaveValue("12");
    await expect(adminPage.getByLabel("Exam Track")).toHaveValue("neet");
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
      alphaRow.getByRole("button", { name: "Undo" })
    ).toBeVisible();

    await adminPage.reload();
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await expect(
      alphaRow.getByRole("button", { name: "Undo" })
    ).toBeVisible();

    await alphaRow.getByRole("button", { name: "Undo" }).click();
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

    await adminPage.getByRole("button", { name: "+ Log a class" }).click();
    await expect(adminPage.getByText("Log a class", { exact: true })).toBeVisible();
    const betaCompletionRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Beta Physics" });
    await betaCompletionRow.getByRole("checkbox", { name: "Complete" }).check();
    await adminPage.getByRole("button", { name: "Save class log" }).click();

    await expect(adminPage.getByText("Log a class", { exact: true })).toBeHidden();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    await expect(adminPage.getByText("No classes logged yet.")).toBeVisible();

    await adminPage.getByRole("button", { name: "+ Log a class" }).click();
    const betaRow = adminPage
      .locator(".fixed [data-chapter-row]")
      .filter({ hasText: "Fixture Beta Physics" });
    await betaRow.getByRole("checkbox", { name: "Complete" }).check();
    await betaRow.getByText("Fixture Beta Physics").click();
    await adminPage.getByRole("checkbox", { name: /Beta Forces/ }).check();
    await adminPage.getByRole("button", { name: "Save class log" }).click();

    await expect(adminPage.getByText("Log a class", { exact: true })).toBeHidden();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    await expect(adminPage.getByText("Beta Forces")).toBeVisible();

    await adminPage.getByRole("button", { name: "Edit log" }).click();
    await expect(adminPage.getByText("Edit class log", { exact: true })).toBeVisible();
    await expect(adminPage.getByRole("checkbox", { name: "Complete" })).toBeHidden();

    await adminPage.getByRole("checkbox", { name: /Beta Forces/ }).uncheck();
    const alphaEditRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Alpha Physics" });
    await alphaEditRow.getByText("Fixture Alpha Physics").click();
    await adminPage.getByRole("checkbox", { name: /Alpha Motion/ }).check();
    await adminPage.getByRole("button", { name: "Save changes" }).click();

    await expect(adminPage.getByText("Edit class log", { exact: true })).toBeHidden();
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

  test("admin can log a cancelled class without moving Curriculum Progress", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000075?tab=curriculum");
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await adminPage.getByLabel("Program").selectOption("2");

    const alphaRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Alpha Physics" });
    await alphaRow.getByText("Fixture Alpha Physics").click();
    const timeBefore = await alphaRow.getByText(/Time:/).textContent();

    await adminPage.getByRole("button", { name: "+ Log a class" }).click();
    await adminPage.getByLabel("Log type").selectOption("class_cancelled");
    await expect(adminPage.getByText("Which class was cancelled?")).toBeVisible();
    await adminPage
      .getByRole("radio", { name: "Fixture Alpha Physics" })
      .check();
    await adminPage.getByRole("button", { name: "Save class log" }).click();

    await expect(adminPage.getByText("Log a class", { exact: true })).toBeHidden();
    await adminPage.getByRole("button", { name: "Logs" }).click();
    const cancelledLog = adminPage
      .locator("[data-curriculum-log-row]")
      .filter({ hasText: "Class Cancelled" });
    await expect(cancelledLog).toContainText("Fixture Alpha Physics");
    await expect(cancelledLog).not.toContainText("Duration:");

    // A second cancellation for the same Chapter and date is rejected.
    await adminPage.getByRole("button", { name: "+ Log a class" }).click();
    await adminPage.getByLabel("Log type").selectOption("class_cancelled");
    await adminPage
      .getByRole("radio", { name: "Fixture Alpha Physics" })
      .check();
    await adminPage.getByRole("button", { name: "Save class log" }).click();
    await expect(
      adminPage.getByText("A Class Cancelled log already exists for this Chapter and date")
    ).toBeVisible();
    await adminPage.getByRole("button", { name: "Cancel" }).click();

    await adminPage.getByRole("button", { name: "Chapters" }).click();
    await alphaRow.getByText("Fixture Alpha Physics").click();
    await expect(alphaRow.getByText(/Time:/)).toHaveText(String(timeBefore));
  });

  test("admin can create, edit, and delete a Doubt Solving log without moving Curriculum Progress", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000075?tab=curriculum");
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await adminPage.getByLabel("Program").selectOption("2");

    const alphaRow = adminPage
      .locator("[data-chapter-row]")
      .filter({ hasText: "Fixture Alpha Physics" });
    await alphaRow.getByText("Fixture Alpha Physics").click();
    const timeBefore = await alphaRow.getByText(/Time:/).textContent();

    await adminPage.getByRole("button", { name: "+ Log a class" }).click();
    await adminPage.getByLabel("Log type").selectOption("doubt_solving");
    await expect(
      adminPage.getByText("Which Chapter did you cover doubts for?")
    ).toBeVisible();
    await adminPage
      .getByRole("radio", { name: "Fixture Alpha Physics" })
      .check();
    const [hours, minutes] = await adminPage.getByRole("spinbutton").all();
    await hours.fill("1");
    await minutes.fill("15");
    await adminPage.getByRole("button", { name: "Save class log" }).click();

    await adminPage.getByRole("button", { name: "Logs" }).click();
    const doubtLog = adminPage
      .locator("[data-curriculum-log-row]")
      .filter({ hasText: "Doubt Solving" });
    await expect(doubtLog).toContainText("Fixture Alpha Physics");
    await expect(doubtLog).toContainText("Duration: 1h 15m");
    await expect(doubtLog).not.toContainText("Topics covered");

    await doubtLog.getByRole("button", { name: "Edit log" }).click();
    await expect(adminPage.getByLabel("Log type")).toBeDisabled();
    const editMinutes = adminPage.getByRole("spinbutton").nth(1);
    await editMinutes.fill("30");
    await adminPage.getByRole("button", { name: "Save changes" }).click();
    await expect(doubtLog).toContainText("Duration: 1h 30m");

    await adminPage.getByRole("button", { name: "Chapters" }).click();
    await expect(alphaRow.getByText(/Time:/)).toHaveText(String(timeBefore));
    const doubtSolvingMetric = adminPage
      .getByText("doubt solving time")
      .locator("..");
    await expect(doubtSolvingMetric).toContainText("1h 30m");

    await adminPage.getByRole("button", { name: "Logs" }).click();
    adminPage.once("dialog", (dialog) => dialog.accept());
    await doubtLog.getByRole("button", { name: "Delete log" }).click();
    await expect(doubtLog).toBeHidden();
  });

  test("admin can delete a log and it stays excluded after reload", async ({
    adminPage,
  }) => {
    await adminPage.goto("/school/75000000075?tab=curriculum");
    await expect(
      adminPage.getByRole("heading", { name: "JEE Main Curriculum Progress" })
    ).toBeVisible();
    await adminPage.getByLabel("Program").selectOption("2");

    await adminPage.getByRole("button", { name: "+ Log a class" }).click();
    const betaRow = adminPage
      .locator(".fixed [data-chapter-row]")
      .filter({ hasText: "Fixture Beta Physics" });
    await betaRow.getByRole("button").first().click();
    await adminPage.getByRole("checkbox", { name: /Beta Forces/ }).check();
    await adminPage.getByRole("button", { name: "Save class log" }).click();

    await expect(adminPage.getByText("Log a class", { exact: true })).toBeHidden();
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
