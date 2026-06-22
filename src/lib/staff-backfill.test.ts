import { describe, it, expect } from "vitest";
import {
  normalizeName,
  splitFullName,
  normalizeAfCode,
  resolveAfCode,
  hrSubjectToSeatRole,
  hrSubjectToSubjectId,
  mapSchoolCodesToCentres,
  parseSheetTsv,
  buildPersonPlan,
  type SheetRow,
  type HrEmployee,
  type CentreRef,
} from "./staff-backfill";

function sheetRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    status: "AUTO_MATCHED",
    email: "t@avantifellows.org",
    role: "teacher",
    lmsName: "Test Teacher",
    proposedAfId: "AF100",
    teamDecision: "",
    correctAfId: "",
    ...overrides,
  };
}

describe("normalizeName", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeName("  R. Nivetha ")).toBe("r nivetha");
    expect(normalizeName("Sivaranjani.S")).toBe("sivaranjani s");
    expect(normalizeName("Anand   Joshi")).toBe("anand joshi");
  });
});

describe("splitFullName", () => {
  it("splits first token from the rest", () => {
    expect(splitFullName("Anjali B O")).toEqual({
      firstName: "Anjali",
      lastName: "B O",
    });
  });

  it("handles single-token and empty names", () => {
    expect(splitFullName("Aryaman")).toEqual({
      firstName: "Aryaman",
      lastName: null,
    });
    expect(splitFullName("  ")).toEqual({ firstName: "", lastName: null });
  });
});

describe("normalizeAfCode", () => {
  it("uppercases valid AF codes", () => {
    expect(normalizeAfCode(" af123 ")).toBe("AF123");
  });

  it("rejects placeholder and malformed codes", () => {
    expect(normalizeAfCode("MT005")).toBeNull();
    expect(normalizeAfCode("TBH123")).toBeNull();
    expect(normalizeAfCode("AF12X")).toBeNull();
    expect(normalizeAfCode("")).toBeNull();
  });
});

describe("resolveAfCode", () => {
  it("includes people missing from the sheet with no code", () => {
    expect(resolveAfCode(undefined)).toEqual({
      include: true,
      code: null,
      source: "not_in_sheet",
    });
  });

  it("excludes on a team exclude decision", () => {
    const result = resolveAfCode(sheetRow({ teamDecision: "exclude" }));
    expect(result.include).toBe(false);
    expect(result.source).toBe("excluded_by_team");
  });

  it("prefers a filled correct_af_id over everything else", () => {
    const result = resolveAfCode(
      sheetRow({ teamDecision: "use correct_af_id", correctAfId: "af200" })
    );
    expect(result).toMatchObject({
      include: true,
      code: "AF200",
      source: "team_correct_af_id",
    });
  });

  it("warns when correct_af_id is not a valid code", () => {
    const result = resolveAfCode(sheetRow({ correctAfId: "MT005" }));
    expect(result.code).toBeNull();
    expect(result.warning).toContain("MT005");
  });

  it("uses the proposed code on an OK decision, even for test accounts", () => {
    const result = resolveAfCode(
      sheetRow({ status: "TEST_ACCOUNT", teamDecision: "OK" })
    );
    expect(result).toMatchObject({
      include: true,
      code: "AF100",
      source: "team_ok_proposed",
    });
  });

  it("trusts AUTO_MATCHED without a decision", () => {
    expect(resolveAfCode(sheetRow())).toMatchObject({
      include: true,
      code: "AF100",
      source: "auto_matched",
    });
  });

  it("rejects an AUTO_MATCHED placeholder code with a warning", () => {
    const result = resolveAfCode(sheetRow({ proposedAfId: "MT005" }));
    expect(result.include).toBe(true);
    expect(result.code).toBeNull();
    expect(result.warning).toContain("MT005");
  });

  it("skips undecided test accounts", () => {
    const result = resolveAfCode(sheetRow({ status: "TEST_ACCOUNT" }));
    expect(result.include).toBe(false);
    expect(result.source).toBe("test_account");
  });

  it("includes CANDIDATE_VERIFY and NEEDS_AF_ID without a code", () => {
    for (const status of ["CANDIDATE_VERIFY", "NEEDS_AF_ID"]) {
      const result = resolveAfCode(sheetRow({ status }));
      expect(result).toMatchObject({
        include: true,
        code: null,
        source: "unconfirmed",
      });
    }
  });
});

describe("hr subject mapping", () => {
  it("maps HR subjects to seat roles", () => {
    expect(hrSubjectToSeatRole("Mathematics")).toBe("maths");
    expect(hrSubjectToSeatRole("Physics")).toBe("physics");
    expect(hrSubjectToSeatRole("APC")).toBe("apc");
    expect(hrSubjectToSeatRole("")).toBeNull();
    expect(hrSubjectToSeatRole(null)).toBeNull();
    expect(hrSubjectToSeatRole("Economics")).toBeNull();
  });

  it("maps HR subjects to db-service subject ids", () => {
    expect(hrSubjectToSubjectId("Mathematics")).toBe(1);
    expect(hrSubjectToSubjectId("Chemistry")).toBe(2);
    expect(hrSubjectToSubjectId("Biology")).toBe(3);
    expect(hrSubjectToSubjectId("Physics")).toBe(4);
    expect(hrSubjectToSubjectId("APC")).toBeNull();
  });
});

const COE: CentreRef = {
  id: 8,
  name: "JNV Adilabad - CoE",
  typeCode: "coe",
  schoolCode: "59525",
};
const NODAL: CentreRef = {
  id: 11,
  name: "JNV Adilabad - Nodal",
  typeCode: "nodal",
  schoolCode: "59525",
};
const SINGLE: CentreRef = {
  id: 3,
  name: "JNV Bengaluru",
  typeCode: "coe",
  schoolCode: "29139",
};

function centreMap(): Map<string, CentreRef[]> {
  return new Map([
    ["59525", [COE, NODAL]],
    ["29139", [SINGLE]],
  ]);
}

describe("mapSchoolCodesToCentres", () => {
  it("maps a single-centre school directly", () => {
    const result = mapSchoolCodesToCentres(["29139"], [], centreMap());
    expect(result.centres).toEqual([SINGLE]);
    expect(result.ambiguous).toEqual([]);
  });

  it("breaks multi-centre ties using program ids", () => {
    expect(
      mapSchoolCodesToCentres(["59525"], [1], centreMap()).centres
    ).toEqual([COE]);
    expect(
      mapSchoolCodesToCentres(["59525"], [2], centreMap()).centres
    ).toEqual([NODAL]);
  });

  it("reports ambiguity when programs cannot break the tie", () => {
    const result = mapSchoolCodesToCentres(["59525"], [], centreMap());
    expect(result.centres).toEqual([]);
    expect(result.ambiguous).toEqual([[COE, NODAL]]);
  });

  it("dedupes centres across school codes and skips unknown schools", () => {
    const result = mapSchoolCodesToCentres(
      ["29139", "29139", "99999"],
      [],
      centreMap()
    );
    expect(result.centres).toEqual([SINGLE]);
  });
});

describe("parseSheetTsv", () => {
  const header =
    "status\temail\trole\tlms_name\tlms_centre\tproposed_af_id\thr_name\thr_centre\tmatch_rule\tother_candidates\tteam_decision (OK / use correct_af_id / exclude)\tcorrect_af_id\tnotes";

  it("parses rows keyed by header prefixes", () => {
    const rows = parseSheetTsv(
      `${header}\nAUTO_MATCHED\tA@avantifellows.org\tteacher\tA Person\t\tAF1\tA Person\t\texact name\t\tOK\t\tfine`
    );
    expect(rows).toEqual([
      {
        status: "AUTO_MATCHED",
        email: "a@avantifellows.org",
        role: "teacher",
        lmsName: "A Person",
        proposedAfId: "AF1",
        teamDecision: "OK",
        correctAfId: "",
      },
    ]);
  });

  it("throws when a required column is missing", () => {
    expect(() => parseSheetTsv("status\temail\n")).toThrow(
      /missing column/i
    );
  });
});

// --- buildPersonPlan ---

interface TestTeacherRow {
  id: number;
  teacher_id: string | null;
  user_id: number;
  user_email: string | null;
  user_name: string;
}

function context(overrides: {
  teachers?: TestTeacherRow[];
  userIdByEmail?: Array<[string, number]>;
  staffUserIds?: number[];
  staffCodes?: string[];
  activeSeats?: string[];
  centres?: Array<[string, CentreRef[]]>;
}) {
  const teachers = overrides.teachers ?? [];
  const byName = new Map<string, TestTeacherRow[]>();
  for (const t of teachers) {
    const key = normalizeName(t.user_name);
    byName.set(key, [...(byName.get(key) ?? []), t]);
  }
  return {
    teacherByCode: new Map(
      teachers.filter((t) => t.teacher_id).map((t) => [t.teacher_id!, t])
    ),
    afTeacherByName: byName,
    teacherByUserId: new Map(teachers.map((t) => [t.user_id, t])),
    userIdByEmail: new Map(overrides.userIdByEmail ?? []),
    staffUserIds: new Set(overrides.staffUserIds ?? []),
    staffCodes: new Set(overrides.staffCodes ?? []),
    activeSeats: new Set(overrides.activeSeats ?? []),
    centresBySchoolCode: new Map(overrides.centres ?? []),
  };
}

function person(overrides: Partial<Parameters<typeof buildPersonPlan>[0]> = {}) {
  return {
    id: 1,
    email: "t@avantifellows.org",
    full_name: "Test Teacher",
    role: "teacher" as const,
    school_codes: ["29139"],
    program_ids: [1],
    user_id: null,
    ...overrides,
  };
}

const HR_PHYSICS: HrEmployee = {
  employee_code: "AF100",
  name: "Test Teacher",
  subject: "Physics",
  staff_type: "Teaching Staff",
  designation: "Senior Teacher",
  centre: "JNV Bengaluru",
  is_vacant: 0,
};

describe("buildPersonPlan", () => {
  it("creates user + coded teacher + subject seat for a clean auto-match", () => {
    const plan = buildPersonPlan(
      person(),
      sheetRow(),
      new Map([["AF100", HR_PHYSICS]]),
      context({ centres: [["29139", [SINGLE]]] }),
      new Map()
    );
    expect(plan).toMatchObject({
      skipped: false,
      code: "AF100",
      userAction: "create",
      teacherAction: "create",
      subjectId: 4,
      designation: "Senior Teacher",
      seats: [{ centreId: 3, role: "physics" }],
    });
  });

  it("links by AF code to an existing email-less teacher row", () => {
    const plan = buildPersonPlan(
      person(),
      sheetRow(),
      new Map(),
      context({
        teachers: [
          {
            id: 9,
            teacher_id: "AF100",
            user_id: 77,
            user_email: null,
            user_name: "Test Teacher",
          },
        ],
        centres: [["29139", [SINGLE]]],
      }),
      new Map()
    );
    expect(plan).toMatchObject({
      userAction: "link_by_af_code",
      existingUserId: 77,
      setEmailOnUser: true,
      teacherAction: "update_existing",
      existingTeacherId: 9,
    });
  });

  it("defers when two emails claim the same AF code", () => {
    const usedCodes = new Map([["AF100", "first@avantifellows.org"]]);
    const plan = buildPersonPlan(
      person(),
      sheetRow(),
      new Map(),
      context({}),
      usedCodes
    );
    expect(plan.skipped).toBe(true);
    expect(plan.skipReason).toBe("needs_review_duplicate_code");
  });

  it("defers a code-less person whose name matches an AF-coded row", () => {
    const plan = buildPersonPlan(
      person({ full_name: "Kanhaiya" }),
      sheetRow({ status: "NEEDS_AF_ID", proposedAfId: "" }),
      new Map(),
      context({
        teachers: [
          {
            id: 7,
            teacher_id: "AF448",
            user_id: 43,
            user_email: null,
            user_name: "Kanhaiya",
          },
        ],
      }),
      new Map()
    );
    expect(plan.skipped).toBe(true);
    expect(plan.skipReason).toBe("needs_review_name_collision");
  });

  it("links by name to a code-less existing AF teacher row", () => {
    const plan = buildPersonPlan(
      person({ full_name: "Not Permanent Person" }),
      sheetRow({ status: "NEEDS_AF_ID", proposedAfId: "" }),
      new Map(),
      context({
        teachers: [
          {
            id: 12,
            teacher_id: null,
            user_id: 55,
            user_email: null,
            user_name: "Not Permanent Person",
          },
        ],
      }),
      new Map()
    );
    expect(plan).toMatchObject({
      skipped: false,
      userAction: "link_by_name",
      existingUserId: 55,
      teacherAction: "update_existing",
    });
  });

  it("creates a new row when a confirmed code differs from the name match", () => {
    const plan = buildPersonPlan(
      person({ full_name: "Kanhaiya" }),
      sheetRow({ proposedAfId: "AF900" }),
      new Map(),
      context({
        teachers: [
          {
            id: 7,
            teacher_id: "AF448",
            user_id: 43,
            user_email: null,
            user_name: "Kanhaiya",
          },
        ],
      }),
      new Map()
    );
    expect(plan.skipped).toBe(false);
    expect(plan.userAction).toBe("create");
    expect(plan.code).toBe("AF900");
    expect(plan.warnings.join(" ")).toContain("AF448");
  });

  it("keeps an existing teacher code when the sheet disagrees", () => {
    const plan = buildPersonPlan(
      person({ user_id: 77 }),
      sheetRow({ proposedAfId: "AF999" }),
      new Map(),
      context({
        teachers: [
          {
            id: 9,
            teacher_id: "AF100",
            user_id: 77,
            user_email: "t@avantifellows.org",
            user_name: "Test Teacher",
          },
        ],
      }),
      new Map()
    );
    expect(plan.code).toBe("AF100");
    expect(plan.warnings.join(" ")).toContain("AF999");
  });

  it("creates staff + pm seats per mapped centre for a coded PM", () => {
    const plan = buildPersonPlan(
      person({
        role: "program_manager",
        full_name: "Pm Person",
        school_codes: ["29139", "59525"],
        program_ids: [1],
      }),
      sheetRow({ role: "program_manager" }),
      new Map(),
      context({ centres: [["29139", [SINGLE]], ["59525", [COE, NODAL]]] }),
      new Map()
    );
    expect(plan.staffAction).toBe("create");
    expect(plan.seats).toEqual([
      { centreId: 3, centreName: "JNV Bengaluru", role: "pm" },
      { centreId: 8, centreName: "JNV Adilabad - CoE", role: "pm" },
    ]);
  });

  it("marks a code-less PM as pending instead of creating staff", () => {
    const plan = buildPersonPlan(
      person({ role: "program_manager", full_name: "Pm Person" }),
      sheetRow({ status: "NEEDS_AF_ID", proposedAfId: "" }),
      new Map(),
      context({}),
      new Map()
    );
    expect(plan.skipped).toBe(false);
    expect(plan.staffAction).toBe("pending_no_code");
    expect(plan.seatGaps.length).toBeGreaterThan(0);
  });

  it("records a seat gap instead of a seat when the subject is unknown", () => {
    const plan = buildPersonPlan(
      person(),
      sheetRow({ status: "CANDIDATE_VERIFY" }),
      new Map(),
      context({ centres: [["29139", [SINGLE]]] }),
      new Map()
    );
    expect(plan.code).toBeNull();
    expect(plan.seats).toEqual([]);
    expect(plan.seatGaps.join(" ")).toContain("no confirmed AF code");
  });

  it("records ambiguity when programs cannot pick the Adilabad centre", () => {
    const plan = buildPersonPlan(
      person({ school_codes: ["59525"], program_ids: [] }),
      sheetRow(),
      new Map([["AF100", HR_PHYSICS]]),
      context({ centres: [["59525", [COE, NODAL]]] }),
      new Map()
    );
    expect(plan.seats).toEqual([]);
    expect(plan.seatGaps.join(" ")).toContain("ambiguous");
  });
});
