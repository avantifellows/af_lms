import { describe, expect, it } from "vitest";

import { parseCurriculumPlanSeedArgs } from "./curriculum-plan-seed-args";

describe("parseCurriculumPlanSeedArgs", () => {
  it("dry-runs against .env.local by default", () => {
    expect(parseCurriculumPlanSeedArgs(["calendar.xlsx"])).toEqual({
      mode: "dry-run",
      envFile: ".env.local",
      workbookPath: "calendar.xlsx",
      adminEmail: "curriculum-plan-seed-script",
      reportFile: null,
      help: false,
    });
  });

  it("reads --apply and every value option", () => {
    expect(
      parseCurriculumPlanSeedArgs([
        "calendar.xlsx",
        "--apply",
        "--env=staging",
        "--admin-email=you@avantifellows.org",
        "--report-file=seed-report.txt",
      ])
    ).toEqual({
      mode: "apply",
      envFile: ".env.staging",
      workbookPath: "calendar.xlsx",
      adminEmail: "you@avantifellows.org",
      reportFile: "seed-report.txt",
      help: false,
    });
    expect(parseCurriculumPlanSeedArgs(["--env-file=.env.prod", "--dry-run", "a.xlsx"])).toMatchObject({
      mode: "dry-run",
      envFile: ".env.prod",
      workbookPath: "a.xlsx",
    });
  });

  it.each([["--help"], ["-h"]])("accepts %s without a workbook", (flag) => {
    expect(parseCurriculumPlanSeedArgs([flag])).toMatchObject({ help: true, workbookPath: "" });
  });

  it.each([
    [["calendar.xlsx", "--apply", "--dry-run"], "Use either --apply or --dry-run, not both."],
    [[], "Pass the workbook path, e.g. npm run curriculum:seed-plans -- calendar.xlsx"],
    [["calendar.xlsx", "--force"], "Unknown argument: --force"],
    [["calendar.xlsx", "other.xlsx"], "Unknown argument: other.xlsx"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCurriculumPlanSeedArgs(argv)).toThrow(message);
  });
});
