import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockGetStudentAcademicLevelCounts } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetStudentAcademicLevelCounts: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
// BigQuery is the external boundary; only its query function is replaced.
vi.mock("@/lib/bigquery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bigquery")>()),
  getStudentAcademicLevelCounts: mockGetStudentAcademicLevelCounts,
}));

import type { UserPermission } from "@/lib/permissions";
import {
  getVisitSummaryAcademicLevelCards,
  getVisitSummarySchool,
  getVisitSummarySchoolFlags,
  getVisitSummarySchoolTeachers,
  type VisitSummarySchool,
} from "./visit-summary-school";
import { buildVisitsActor } from "./visits-policy";

const SCHOOL: VisitSummarySchool = {
  code: "SC001",
  name: "Test School",
  region: "Bhopal",
  udise_code: "23010100101",
  af_school_category: "JNV",
};

// A level-3 admin: every School and Centre.
const ADMIN = { email: "admin@avantifellows.org", level: 3, role: "admin", read_only: false } as UserPermission;

// A PM seated only at the School's CoE (Centre 101): School access through the seat, Centre access
// to 101 only, and so confined to it (no whole-School roster page).
const COE_SEATED_PM = {
  email: "pm@avantifellows.org",
  level: 1,
  role: "program_manager",
  read_only: false,
  school_codes: [],
  scope: { schools: new Set(["SC001"]), centres: new Set([101]), programs: new Set([1]) },
} as UserPermission;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetStudentAcademicLevelCounts.mockReset();
});

describe("getVisitSummarySchool", () => {
  const admin = buildVisitsActor("admin@avantifellows.org", {
    email: "admin@avantifellows.org", level: 3, role: "admin", read_only: false, program_ids: [1],
  } as UserPermission);

  it("returns the School when the lookup finds it, and null otherwise", async () => {
    mockQuery.mockResolvedValueOnce([SCHOOL]).mockResolvedValueOnce([]);

    await expect(getVisitSummarySchool(admin, "SC001")).resolves.toEqual(SCHOOL);
    await expect(getVisitSummarySchool(admin, "NOPE")).resolves.toBeNull();
  });
});

describe("getVisitSummarySchoolTeachers", () => {
  const seat = (type_code: string | null, role: string, name: string, teacher_subject: string | null = null) => ({
    type_code, role, name, teacher_subject,
  });

  it("groups seats CoE, Nodal, other types, then untyped Centres as Other", async () => {
    mockQuery.mockResolvedValue([
      seat(null, "maths", "Untyped Teacher"),
      seat("emrs", "physics", "Emrs Teacher"),
      seat("nodal", "physics", "Nodal Teacher"),
      seat("coe", "physics", "CoE Teacher"),
    ]);

    const groups = await getVisitSummarySchoolTeachers("SC001");

    expect(groups.map((group) => group.tag)).toEqual(["CoE", "Nodal", "emrs", "Other"]);
  });

  it("sorts seats by subject, then name", async () => {
    mockQuery.mockResolvedValue([
      seat("coe", "physics", "Zara Khan"),
      seat("coe", "chemistry", "Mohan Das"),
      seat("coe", "physics", "Anil Rao"),
    ]);

    const [coe] = await getVisitSummarySchoolTeachers("SC001");

    expect(coe.seats).toEqual([
      { subject: "CHEMISTRY", name: "Mohan Das" },
      { subject: "PHYSICS", name: "Anil Rao" },
      { subject: "PHYSICS", name: "Zara Khan" },
    ]);
  });

  it("reads only seats with a person in them (an inner join on the seat's user)", async () => {
    mockQuery.mockResolvedValue([]);

    await getVisitSummarySchoolTeachers("SC001");

    expect(mockQuery.mock.calls[0][0]).toMatch(/\bJOIN "user" u ON u\.id = cp\.user_id/);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/LEFT JOIN "user"/);
  });

  it("shows a subject_tbd seat under its teacher's own subject, or SUBJECT TBD when none is set", async () => {
    mockQuery.mockResolvedValue([
      seat("coe", "subject_tbd", "Priya Sen", "Biology"),
      seat("coe", "subject_tbd", "Ravi Das", null),
    ]);

    const [coe] = await getVisitSummarySchoolTeachers("SC001");

    expect(coe.seats).toEqual([
      { subject: "BIOLOGY", name: "Priya Sen" },
      { subject: "SUBJECT TBD", name: "Ravi Das" },
    ]);
  });

  it("is empty when the School has no teaching seats", async () => {
    mockQuery.mockResolvedValue([]);

    await expect(getVisitSummarySchoolTeachers("SC001")).resolves.toEqual([]);
  });
});

describe("getVisitSummaryAcademicLevelCards", () => {
  const coe = { id: "101", name: "JNV Bhopal CoE", type_code: "coe", program_id: 1 };
  const nodal = { id: "102", name: "JNV Bhopal Nodal", type_code: "nodal", program_id: 2 };

  it("lists a card's levels best first, merging rows of the same level, with unknown levels last", async () => {
    mockQuery.mockResolvedValue([coe]);
    mockGetStudentAcademicLevelCounts.mockResolvedValue([
      { grade: 11, stream: "engineering", academicLevel: "Not Qualified", students: 2 },
      { grade: 11, stream: "engineering", academicLevel: "Legacy L9", students: 1 },
      { grade: 11, stream: "engineering", academicLevel: "M3", students: 4 },
      { grade: 11, stream: "Engineering", academicLevel: "M1", students: 3 },
      { grade: 11, stream: "pcm", academicLevel: "M1", students: 2 },
      { grade: 11, stream: "engineering", academicLevel: null, students: 6 },
    ]);

    const result = await getVisitSummaryAcademicLevelCards(SCHOOL, ADMIN);

    expect(result).toEqual({
      available: true,
      cards: [
        {
          centreId: "101", centreName: "JNV Bhopal CoE", tag: "CoE", grade: 11, exam: "JEE",
          levels: [
            { level: "M1", students: 5 },
            { level: "M3", students: 4 },
            { level: "Not Qualified", students: 2 },
            { level: "Legacy L9", students: 1 },
          ],
          na: 6,
          total: 18,
          canOpen: true,
        },
      ],
    });
  });

  it("shows every Centre's cards, opening only those whose Centre page the viewer can open", async () => {
    mockQuery.mockResolvedValue([coe, nodal]);
    mockGetStudentAcademicLevelCounts.mockResolvedValue([{ grade: 11, stream: "pcm", academicLevel: "M1", students: 1 }]);

    const cardsFor = async (permission: UserPermission) => {
      const result = await getVisitSummaryAcademicLevelCards(SCHOOL, permission);
      return result.available && result.cards.map((card) => `${card.tag} ${card.canOpen}`);
    };

    // Seated only at the CoE, the PM sees the Nodal card too, but can't open the Nodal's page.
    expect(await cardsFor(COE_SEATED_PM)).toEqual(["CoE true", "Nodal false"]);
    expect(await cardsFor(ADMIN)).toEqual(["CoE true", "Nodal true"]);
  });

  it("skips streams with no exam and empty rows, so such a class gets no card", async () => {
    mockQuery.mockResolvedValue([coe]);
    mockGetStudentAcademicLevelCounts.mockResolvedValue([
      { grade: 11, stream: "ca", academicLevel: "M1", students: 5 },
      { grade: 11, stream: "foundation", academicLevel: null, students: 3 },
      { grade: 11, stream: null, academicLevel: null, students: 2 },
      { grade: 12, stream: "medical", academicLevel: "B1", students: 0 },
    ]);

    await expect(getVisitSummaryAcademicLevelCards(SCHOOL, ADMIN)).resolves.toEqual({ available: true, cards: [] });
  });

  it("orders cards CoE before Nodal, then by grade, JEE before NEET", async () => {
    mockQuery.mockResolvedValue([nodal, coe]);
    mockGetStudentAcademicLevelCounts.mockImplementation(async (_udise: string, program: string) =>
      program === "JNV CoE"
        ? [
            { grade: 12, stream: "medical", academicLevel: "B1", students: 1 },
            { grade: 12, stream: "pcmb", academicLevel: "M2", students: 1 },
            { grade: 11, stream: "pcb", academicLevel: "B2", students: 1 },
          ]
        : [{ grade: 11, stream: "pcm", academicLevel: "M1", students: 1 }]
    );

    const result = await getVisitSummaryAcademicLevelCards(SCHOOL, ADMIN);

    expect(result.available && result.cards.map((card) => `${card.tag} ${card.grade} ${card.exam}`)).toEqual([
      "CoE 11 NEET",
      "CoE 12 JEE",
      "CoE 12 NEET",
      "Nodal 11 JEE",
    ]);
  });

  it("queries BigQuery by the School code when it has no UDISE code, and skips Centres with no known programme", async () => {
    mockQuery.mockResolvedValue([coe, { ...nodal, program_id: null }, { ...nodal, id: "103", program_id: 9999 }]);
    mockGetStudentAcademicLevelCounts.mockResolvedValue([]);

    await getVisitSummaryAcademicLevelCards({ ...SCHOOL, udise_code: null }, ADMIN);

    expect(mockGetStudentAcademicLevelCounts.mock.calls).toEqual([["SC001", "JNV CoE", [11, 12]]]);
  });

  it("is unavailable when any BigQuery read fails", async () => {
    mockQuery.mockResolvedValue([coe, nodal]);
    mockGetStudentAcademicLevelCounts
      .mockResolvedValueOnce([{ grade: 11, stream: "pcm", academicLevel: "M1", students: 1 }])
      .mockRejectedValueOnce(new Error("BigQuery down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getVisitSummaryAcademicLevelCards(SCHOOL, ADMIN)).resolves.toEqual({ available: false });
    consoleError.mockRestore();
  });
});

describe("getVisitSummarySchoolFlags", () => {
  const flag = (overrides: Record<string, unknown>) => ({
    id: 501,
    status: "open",
    student_name: "Asha Verma",
    grade: 11,
    centre_id: "101",
    centre_type_code: "coe",
    centre_ids: ["101"],
    raised_by_email: "ravi.pm@avantifellows.org",
    raised_by_name: "Ravi PM",
    inserted_at: "2026-10-20T20:00:00.000Z",
    update_count: 3,
    ...overrides,
  });

  it("returns the open flags as rows, in the query's order, and counts the resolved ones", async () => {
    mockQuery.mockResolvedValue([
      flag({}),
      flag({ id: 502, status: "resolved" }),
      flag({
        id: 503, student_name: "Kiran Rao", grade: null, centre_id: null, centre_type_code: null, centre_ids: null,
        raised_by_name: null, update_count: 1,
      }),
      flag({ id: 504, status: "resolved" }),
    ]);

    const flags = await getVisitSummarySchoolFlags(SCHOOL, ADMIN);

    expect(flags).toEqual({
      open: [
        {
          id: 501, studentName: "Asha Verma", grade: 11, centreTag: "CoE",
          raisedBy: "Ravi PM", raisedAt: "2026-10-20T20:00:00.000Z", updateCount: 3,
          notesHref: "/school/SC001?tab=enrollment&flag=501",
        },
        {
          id: 503, studentName: "Kiran Rao", grade: null, centreTag: null,
          raisedBy: "ravi.pm@avantifellows.org", raisedAt: "2026-10-20T20:00:00.000Z", updateCount: 1,
          notesHref: "/school/SC001?tab=enrollment&flag=503",
        },
      ],
      resolvedCount: 2,
    });
  });

  it("tags a flag at an untyped Centre as Other, and a Nodal one as Nodal", async () => {
    mockQuery.mockResolvedValue([
      flag({ id: 1, centre_type_code: null }),
      flag({ id: 2, centre_type_code: "nodal" }),
    ]);

    const { open } = await getVisitSummarySchoolFlags(SCHOOL, ADMIN);

    expect(open.map((row) => row.centreTag)).toEqual(["Other", "Nodal"]);
  });

  it("links a viewer who may open the School's roster page to the flag there, encoding the School code", async () => {
    mockQuery.mockResolvedValue([flag({ id: 7 })]);

    const { open } = await getVisitSummarySchoolFlags({ ...SCHOOL, code: "SC 001/A" }, ADMIN);

    expect(open[0].notesHref).toBe("/school/SC%20001%2FA?tab=enrollment&flag=7");
  });

  it("links a Centre-seated PM, who can't open the School's roster page, to the flag on their Centre's page", async () => {
    mockQuery.mockResolvedValue([
      flag({ id: 1, centre_id: "101" }),
      // At the School's Nodal, where this PM holds no seat.
      flag({ id: 2, centre_id: "102", centre_type_code: "nodal", centre_ids: ["102"] }),
      // No active physical Centre runs the flag's programme.
      flag({ id: 3, centre_id: null, centre_type_code: null, centre_ids: null }),
    ]);

    const { open } = await getVisitSummarySchoolFlags(SCHOOL, COE_SEATED_PM);

    expect(open.map((row) => row.notesHref)).toEqual(["/centre/101?tab=enrollment&flag=1", null, null]);
  });

  it("links a Centre-seated PM to whichever of the programme's Centres they can open, not only the first", async () => {
    // Two active physical Centres run the flag's programme; the tag shows the first (100), but the
    // PM's seat is at 101.
    mockQuery.mockResolvedValue([flag({ id: 4, centre_id: "100", centre_ids: ["100", "101"] })]);

    const { open } = await getVisitSummarySchoolFlags(SCHOOL, COE_SEATED_PM);

    expect(open[0].notesHref).toBe("/centre/101?tab=enrollment&flag=4");
  });
});
