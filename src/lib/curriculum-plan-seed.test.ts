import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import {
  buildCurriculumPlanSeed,
  runCurriculumPlanSeed,
  type CurriculumPlanSeedStore,
  type PlanDraft,
  type SeedChapter,
} from "./curriculum-plan-seed";

const SUBJECT_COLUMNS = ["Physics", "Chemistry", "Mathematics", "Biology"] as const;
type SubjectColumn = (typeof SUBJECT_COLUMNS)[number];

type TabRow =
  | { date: string; cells: Partial<Record<SubjectColumn, string>> }
  | { date: string; wholeDay: string; days?: number };

function day(date: string, cells: Partial<Record<SubjectColumn, string>> = {}): TabRow {
  return { date, cells };
}

// A label written once and merged across all four subject columns (holidays, AIAT,
// Unit Test, Mid Term ...), optionally merged down over several day rows.
function wholeDay(date: string, label: string, days = 1): TabRow {
  return { date, wholeDay: label, days };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Mirrors the real planner tabs: a title row, a Week | Date | Day | subjects header, then
// one row per calendar day. Round-tripped through a buffer so merges and dates load the way
// a real .xlsx file does.
async function buildWorkbook(tabs: Record<string, TabRow[]>): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(tabs)) {
    const sheet = book.addWorksheet(name);
    sheet.getCell("B1").value = "AY 2026-27 PLANNER";
    sheet.getRow(2).values = ["Week", "Date", "Day", ...SUBJECT_COLUMNS];
    let rowNumber = 3;
    for (const row of rows) {
      if ("wholeDay" in row) {
        const days = row.days ?? 1;
        for (let i = 0; i < days; i += 1) {
          sheet.getCell(rowNumber + i, 2).value = new Date(`${addDays(row.date, i)}T00:00:00Z`);
        }
        sheet.getCell(rowNumber, 4).value = row.wholeDay;
        sheet.mergeCells(rowNumber, 4, rowNumber + days - 1, 7);
        rowNumber += days;
        continue;
      }
      sheet.getCell(rowNumber, 2).value = new Date(`${row.date}T00:00:00Z`);
      SUBJECT_COLUMNS.forEach((subject, index) => {
        const value = row.cells[subject];
        if (value !== undefined) sheet.getCell(rowNumber, 4 + index).value = value;
      });
      rowNumber += 1;
    }
  }
  const buffer = await book.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer as ArrayBuffer);
  return loaded;
}

const G12_CHAPTERS: SeedChapter[] = [
  { chapterId: 1220, chapterCode: "12P20", chapterName: "Magnetic Effects of Electric Current and Magnetism", subjectName: "Physics" },
  { chapterId: 1221, chapterCode: "12P21", chapterName: "Electromagnetic Induction", subjectName: "Physics" },
  { chapterId: 1222, chapterCode: "12P22", chapterName: "Alternating Current", subjectName: "Physics" },
  { chapterId: 1223, chapterCode: "12P23", chapterName: "Ray Optics", subjectName: "Physics" },
  { chapterId: 1226, chapterCode: "12P26", chapterName: "Nuclear Physics", subjectName: "Physics" },
  { chapterId: 1324, chapterCode: "12C24", chapterName: "Coordination Compounds", subjectName: "Chemistry" },
  { chapterId: 1325, chapterCode: "12C25", chapterName: "Haloalkanes and Haloarenes", subjectName: "Chemistry" },
  { chapterId: 1422, chapterCode: "12M22", chapterName: "Vector Algebra", subjectName: "Maths" },
  { chapterId: 1529, chapterCode: "12B29", chapterName: "Evolution", subjectName: "Biology" },
];

const G11_CHAPTERS: SeedChapter[] = [
  { chapterId: 1103, chapterCode: "11P3", chapterName: "Motion in One Dimension", subjectName: "Physics" },
  { chapterId: 1105, chapterCode: "11P5", chapterName: "Newton's Laws of Motion and Friction", subjectName: "Physics" },
  { chapterId: 1110, chapterCode: "11P10", chapterName: "Gravitation", subjectName: "Physics" },
  { chapterId: 1201, chapterCode: "11C1", chapterName: "Mole Concept", subjectName: "Chemistry" },
  { chapterId: 1301, chapterCode: "11M1", chapterName: "Fundamentals of Mathematics", subjectName: "Maths" },
  { chapterId: 1401, chapterCode: "11B1", chapterName: "The Living World", subjectName: "Biology" },
];

const CHAPTERS_BY_GRADE = { 11: G11_CHAPTERS, 12: G12_CHAPTERS };

describe("buildCurriculumPlanSeed", () => {
  it("reads rich-text, hyperlink and formula cells, and a formula date", async () => {
    const workbook = await buildWorkbook({
      G12: [day("2026-07-08"), day("2026-07-09"), day("2026-07-10"), day("2026-11-30")],
      "G11 (Others)": [day("2026-07-07", { Chemistry: "Mole Concept -1" }), day("2027-03-08")],
      "G11 (HYD)": [day("2027-02-08")],
    });
    const g12 = workbook.getWorksheet("G12")!;
    // Rows 3–5 are 8–10 Jul; columns 4–7 are Physics, Chemistry, Mathematics, Biology.
    g12.getCell(3, 4).value = { richText: [{ text: "Ray " }, { text: "Optics -1" }] };
    g12.getCell(4, 5).value = { text: "Coordination Compounds -1", hyperlink: "https://example.org" };
    g12.getCell(5, 7).value = { formula: "A1", result: "Evolution -1" };
    g12.getCell(5, 2).value = { formula: "B4+1", result: new Date("2026-07-10T00:00:00Z") };
    g12.getCell(5, 6).value = 42;
    g12.getCell(4, 6).value = { formula: "C1", result: undefined } as unknown as ExcelJS.CellValue;

    const { drafts, report } = buildCurriculumPlanSeed(workbook, CHAPTERS_BY_GRADE);

    expect(drafts[0].chapters).toEqual([
      { chapterId: 1223, dueDate: "2026-07-08", testDate: null },
      { chapterId: 1324, dueDate: "2026-07-09", testDate: null },
      { chapterId: 1529, dueDate: "2026-07-10", testDate: null },
    ]);
    expect(report[0].unmatchedRows).toEqual([
      { subject: "Mathematics", sheetName: "42", kind: "teaching", dates: ["2026-07-10"], reason: "no_match", candidates: [] },
    ]);
  });

  it("dates a Chapter by its last teaching day and closes each plan on its tab's last date", async () => {
    const workbook = await buildWorkbook({
      G12: [
        day("2026-07-08", { Physics: "Ray Optics -1" }),
        day("2026-07-09", { Physics: "Ray Optics -2" }),
        day("2026-07-10", { Physics: "Ray Optics - 3" }),
        day("2026-11-30"),
      ],
      "G11 (Others)": [day("2026-07-07", { Chemistry: "Mole Concept -1" }), day("2027-03-08")],
      "G11 (HYD)": [day("2026-06-09", { Chemistry: "Mole Concept -1" }), day("2027-02-08")],
    });

    const { drafts } = buildCurriculumPlanSeed(workbook, CHAPTERS_BY_GRADE);

    expect(drafts).toEqual([
      {
        tab: "G12",
        title: "G12 2026-27",
        academicYear: "2026-2027",
        grade: 12,
        examTracks: ["jee_main", "jee_advanced", "neet"],
        closureDate: "2026-11-30",
        chapters: [{ chapterId: 1223, dueDate: "2026-07-10", testDate: null }],
      },
      {
        tab: "G11 (Others)",
        title: "G11 2026-27 (Others)",
        academicYear: "2026-2027",
        grade: 11,
        examTracks: ["jee_main", "jee_advanced", "neet"],
        closureDate: "2027-03-08",
        chapters: [{ chapterId: 1201, dueDate: "2026-07-07", testDate: null }],
      },
      {
        tab: "G11 (HYD)",
        title: "G11 2026-27 (HYD)",
        academicYear: "2026-2027",
        grade: 11,
        examTracks: ["jee_main", "jee_advanced", "neet"],
        closureDate: "2027-02-08",
        chapters: [{ chapterId: 1201, dueDate: "2026-06-09", testDate: null }],
      },
    ]);
  });

  it("sets the test date from both the `Chapter Test - X` and `X Test` forms", async () => {
    const workbook = await buildWorkbook({
      G12: [
        day("2026-07-08", { Physics: "Ray Optics -1", Chemistry: "Coordination Compounds -1", Mathematics: "Vector Algebra -1", Biology: "Evolution -1" }),
        day("2026-07-09", { Physics: "Ray Optics -2", Chemistry: "Haloalkanes and Haloarenes -1", Mathematics: "Practice" }),
        day("2026-07-10", { Physics: "Chapter Test - Ray Optics", Chemistry: "Coordination Compounds Test", Mathematics: "Chapter Test: Vector Algebra", Biology: "Chapter Test : Evolution" }),
        day("2026-07-11", { Chemistry: "Chapter Test-Haloalkanes and Haloarenes Chapter Test " }),
        day("2026-11-30"),
      ],
      "G11 (Others)": [day("2027-03-08")],
      "G11 (HYD)": [day("2027-02-08")],
    });

    const { drafts } = buildCurriculumPlanSeed(workbook, CHAPTERS_BY_GRADE);

    expect(drafts[0].chapters).toEqual([
      { chapterId: 1223, dueDate: "2026-07-09", testDate: "2026-07-10" },
      { chapterId: 1324, dueDate: "2026-07-08", testDate: "2026-07-10" },
      { chapterId: 1325, dueDate: "2026-07-09", testDate: "2026-07-11" },
      { chapterId: 1422, dueDate: "2026-07-08", testDate: "2026-07-10" },
      { chapterId: 1529, dueDate: "2026-07-08", testDate: "2026-07-10" },
    ]);
  });

  it("matches misspelt and aliased Sheet names to LMS Chapters", async () => {
    const workbook = await buildWorkbook({
      G12: [
        day("2026-07-27", { Physics: "EMI - 1" }),
        day("2026-07-28", { Physics: "EMI - 2" }),
        day("2026-07-29", { Physics: "Chapter Test - EMI" }),
        day("2026-08-13", { Physics: "AC - 1" }),
        day("2026-08-14", { Physics: "AC Test" }),
        day("2026-10-27", { Physics: "Nuclear Physcs - 1" }),
        day("2026-11-02", { Physics: "Nuclear Physcs - 2" }),
        day("2026-11-03", { Physics: "Chapter Test - Nuclear Physics" }),
        day("2026-11-30"),
      ],
      "G11 (Others)": [
        day("2026-08-01", { Physics: "Motion in 1 D - 1" }),
        day("2026-08-08", { Physics: "Motion in 1 D - 7" }),
        day("2026-08-14", { Physics: "Chapter Test - Motion in 1D" }),
        day("2026-09-01", { Physics: "Newtons Laws of Motion & Friction - 1" }),
        day("2027-03-08"),
      ],
      "G11 (HYD)": [
        day("2026-06-09", { Mathematics: "Fundamentals of Mathematics II - 1" }),
        day("2027-02-08"),
      ],
    });
    const chaptersByGrade = {
      12: G12_CHAPTERS,
      11: [
        ...G11_CHAPTERS.filter((chapter) => chapter.chapterId !== 1301),
        { chapterId: 1301, chapterCode: "11M1", chapterName: "Fundamentals of Mathematics 2", subjectName: "Maths" },
      ],
    };

    const { drafts } = buildCurriculumPlanSeed(workbook, chaptersByGrade);

    expect(drafts.map((draft) => draft.chapters)).toEqual([
      [
        { chapterId: 1221, dueDate: "2026-07-28", testDate: "2026-07-29" },
        { chapterId: 1222, dueDate: "2026-08-13", testDate: "2026-08-14" },
        { chapterId: 1226, dueDate: "2026-11-02", testDate: "2026-11-03" },
      ],
      [
        { chapterId: 1103, dueDate: "2026-08-08", testDate: "2026-08-14" },
        { chapterId: 1105, dueDate: "2026-09-01", testDate: null },
      ],
      [{ chapterId: 1301, dueDate: "2026-06-09", testDate: null }],
    ]);
  });

  it("leaves unmatched and ambiguous names undated and reports them as unmatched Sheet rows", async () => {
    const workbook = await buildWorkbook({
      G12: [day("2026-11-30")],
      "G11 (Others)": [
        day("2027-01-19", { Mathematics: "Geometry of Complex Numbers - 1", Physics: "Gravitation - 1" }),
        day("2027-01-20", { Mathematics: "Geometry of Complex Numbers - 2", Physics: "Gravitation - 2" }),
        day("2027-01-21", { Mathematics: "Geometry of Complex Numbers Test", Physics: "Chapter Test - Gravitation" }),
        day("2027-03-08"),
      ],
      "G11 (HYD)": [day("2027-02-08")],
    });
    // Two effective Physics Chapters share the name, so the Sheet name can't pick one.
    const chaptersByGrade = {
      12: G12_CHAPTERS,
      11: [
        ...G11_CHAPTERS,
        { chapterId: 1199, chapterCode: "11P10-dup", chapterName: "Gravitation", subjectName: "Physics" },
      ],
    };

    const { drafts, report } = buildCurriculumPlanSeed(workbook, chaptersByGrade);

    expect(drafts[1].chapters).toEqual([]);
    expect(report[1].unmatchedRows).toEqual([
      { subject: "Physics", sheetName: "Gravitation", kind: "teaching", dates: ["2027-01-19", "2027-01-20"], reason: "ambiguous", candidates: ["11P10 Gravitation", "11P10-dup Gravitation"] },
      { subject: "Mathematics", sheetName: "Geometry of Complex Numbers", kind: "teaching", dates: ["2027-01-19", "2027-01-20"], reason: "no_match", candidates: [] },
      { subject: "Physics", sheetName: "Chapter Test - Gravitation", kind: "test", dates: ["2027-01-21"], reason: "ambiguous", candidates: ["11P10 Gravitation", "11P10-dup Gravitation"] },
      { subject: "Mathematics", sheetName: "Geometry of Complex Numbers Test", kind: "test", dates: ["2027-01-21"], reason: "no_match", candidates: [] },
    ]);
  });

  it("never dates or reports Practice, Revision, Buffer, holiday, AIAT, Unit Test, Mid Term or Bootcamp days", async () => {
    const workbook = await buildWorkbook({
      G12: [
        wholeDay("2026-07-01", "Bootcamp 2026", 4),
        wholeDay("2026-07-05", "Weekly Off"),
        day("2026-07-06", { Physics: "Revision", Chemistry: "Revision and Doubt Solving" }),
        day("2026-07-08", { Physics: "Ray Optics -1", Chemistry: "Practice " }),
        day("2026-07-09", { Physics: "Ray Optics -2", Chemistry: "Buffer Test", Biology: "Buffer Day" }),
        wholeDay("2026-07-10", "Unit Test 02", 3),
        wholeDay("2026-07-13", "AIAT 02 | (JEE Mains & NEET)  Exam Conduction & Paper Solving"),
        wholeDay("2026-07-14", "Independence Day"),
        wholeDay("2026-07-15", "Mid Term Examinations", 2),
        day("2026-07-17", { Physics: "Practice", Mathematics: "Revision and Practice", Biology: "Holiday" }),
        day("2026-07-18", { Physics: "Buffer", Chemistry: "AIAT 04 | (JEE Advanced / CET) Paper Solving" }),
        day("2026-07-20", { Physics: "Chapter Test - Ray Optics" }),
        wholeDay("2026-11-21", "Pre Board-I", 10),
      ],
      "G11 (Others)": [wholeDay("2026-07-01", "North Region Bootcamp & Travel to Center", 5), day("2027-03-08")],
      "G11 (HYD)": [wholeDay("2026-06-08", "Baseline Test "), day("2027-02-08")],
    });

    const { drafts, report } = buildCurriculumPlanSeed(workbook, CHAPTERS_BY_GRADE);

    expect(drafts[0]).toMatchObject({
      closureDate: "2026-11-30",
      chapters: [{ chapterId: 1223, dueDate: "2026-07-09", testDate: "2026-07-20" }],
    });
    expect(report.map((tab) => tab.unmatchedRows)).toEqual([[], [], []]);
  });

  it("reports matched Chapters, uncovered LMS Chapters and duplicates", async () => {
    const workbook = await buildWorkbook({
      G12: [
        day("2026-07-08", { Physics: "Ray Optics -1", Biology: "Evolution -1" }),
        day("2026-07-09", { Physics: "Ray Optics -2", Biology: "Chapter Test - Evolution" }),
        day("2026-07-10", { Physics: "EMI - 1", Biology: "Evolution -2" }),
        day("2026-07-11", { Physics: "Ray Optics -3", Biology: "Chapter Test - Evolution" }),
        day("2026-07-13", { Physics: "Chapter Test - Ray Optics", Chemistry: "Chapter Test - Coordination Compounds" }),
        day("2026-11-30"),
      ],
      "G11 (Others)": [day("2027-03-08")],
      "G11 (HYD)": [day("2027-02-08")],
    });

    const { drafts, report } = buildCurriculumPlanSeed(workbook, CHAPTERS_BY_GRADE);

    expect(drafts[0].chapters).toEqual([
      { chapterId: 1221, dueDate: "2026-07-10", testDate: null },
      { chapterId: 1223, dueDate: "2026-07-11", testDate: "2026-07-13" },
      { chapterId: 1529, dueDate: "2026-07-10", testDate: "2026-07-11" },
    ]);
    expect(report[0].matched).toEqual([
      { subject: "Physics", chapter: "12P21 Electromagnetic Induction", sheetNames: ["EMI"], dueDate: "2026-07-10", testDate: null },
      { subject: "Physics", chapter: "12P23 Ray Optics", sheetNames: ["Ray Optics", "Chapter Test - Ray Optics"], dueDate: "2026-07-11", testDate: "2026-07-13" },
      { subject: "Biology", chapter: "12B29 Evolution", sheetNames: ["Evolution", "Chapter Test - Evolution"], dueDate: "2026-07-10", testDate: "2026-07-11" },
    ]);
    expect(report[0].unmatchedRows).toEqual([
      { subject: "Chemistry", sheetName: "Chapter Test - Coordination Compounds", kind: "test", dates: ["2026-07-13"], reason: "test_without_teaching", candidates: ["12C24 Coordination Compounds"] },
    ]);
    expect(report[0].uncoveredChapters).toEqual([
      { subject: "Physics", chapter: "12P20 Magnetic Effects of Electric Current and Magnetism" },
      { subject: "Physics", chapter: "12P22 Alternating Current" },
      { subject: "Physics", chapter: "12P26 Nuclear Physics" },
      { subject: "Chemistry", chapter: "12C24 Coordination Compounds" },
      { subject: "Chemistry", chapter: "12C25 Haloalkanes and Haloarenes" },
      { subject: "Maths", chapter: "12M22 Vector Algebra" },
    ]);
    expect(report[0].duplicates).toEqual([
      { subject: "Physics", chapter: "12P23 Ray Optics", kind: "teaching", dates: ["2026-07-08 to 2026-07-09", "2026-07-11 to 2026-07-11"] },
      { subject: "Biology", chapter: "12B29 Evolution", kind: "test", dates: ["2026-07-09", "2026-07-11"] },
    ]);
  });
});

// In-memory stand-in for the Curriculum Plans tables (the database boundary).
function fakeStore(existing: Array<{ title: string; academicYear: string; grade: number }> = []) {
  const plans: Array<PlanDraft & { id: number }> = [];
  const store: CurriculumPlanSeedStore = {
    async loadChapters(grade) {
      return CHAPTERS_BY_GRADE[grade as 11 | 12];
    },
    async existingPlanTitles(academicYear, grade) {
      return [...existing, ...plans]
        .filter((plan) => plan.academicYear === academicYear && plan.grade === grade)
        .map((plan) => plan.title);
    },
    async createDraftPlans(drafts) {
      const ids = drafts.map((_draft, index) => ({ id: 100 + plans.length + index }));
      plans.push(...drafts.map((draft, index) => ({ ...draft, ...ids[index] })));
      return ids;
    },
  };
  return { store, plans };
}

async function seedWorkbook(): Promise<ExcelJS.Workbook> {
  return buildWorkbook({
    G12: [
      day("2026-07-08", { Physics: "Ray Optics -1", Chemistry: "Coordination Compounds -1", Biology: "Evolution -1" }),
      day("2026-07-09", { Physics: "Chapter Test - Ray Optics", Chemistry: "Coordination Compounds -1", Biology: "Chapter Test - Evolution" }),
      day("2026-07-10", { Physics: "Ray Optics -2", Chemistry: "Coordination Compounds Test", Mathematics: "Matrices - 1", Biology: "Chapter Test - Evolution" }),
      day("2026-11-30"),
    ],
    "G11 (Others)": [day("2026-07-07", { Chemistry: "Mole Concept -1" }), day("2026-07-09", { Chemistry: "Chapter Test - Mole Concept" }), day("2027-03-08")],
    "G11 (HYD)": [day("2026-06-09", { Physics: "Motion in 1 D - 1" }), day("2027-02-08")],
  });
}

describe("runCurriculumPlanSeed", () => {
  it("writes nothing by default and prints the four report sections per tab", async () => {
    const { store, plans } = fakeStore();

    const result = await runCurriculumPlanSeed({ workbook: await seedWorkbook(), mode: "dry-run", store });

    expect(result.ok).toBe(true);
    expect(plans).toEqual([]);
    expect(result.created).toEqual([]);
    const g12 = result.reportText.slice(0, result.reportText.indexOf("== G11 (Others)"));
    expect(g12).toBe(
      [
        "== G12 → \"G12 2026-27\" (Grade 12, closes 2026-11-30) ==",
        "Matched Chapters (3)",
        "- Physics: 12P23 Ray Optics — due 2026-07-10, test 2026-07-09 [Ray Optics | Chapter Test - Ray Optics]",
        "- Chemistry: 12C24 Coordination Compounds — due 2026-07-09, test 2026-07-10 [Coordination Compounds | Coordination Compounds Test]",
        "- Biology: 12B29 Evolution — due 2026-07-08, test 2026-07-10 [Evolution | Chapter Test - Evolution]",
        "Unmatched Sheet rows (1)",
        "- Mathematics: \"Matrices\" (teaching; 2026-07-10) — no match",
        "Uncovered LMS Chapters (6)",
        "- Physics: 12P20 Magnetic Effects of Electric Current and Magnetism",
        "- Physics: 12P21 Electromagnetic Induction",
        "- Physics: 12P22 Alternating Current",
        "- Physics: 12P26 Nuclear Physics",
        "- Chemistry: 12C25 Haloalkanes and Haloarenes",
        "- Maths: 12M22 Vector Algebra",
        "Duplicates (1)",
        "- Biology: 12B29 Evolution — test: 2026-07-09, 2026-07-10",
        "",
        "",
      ].join("\n")
    );
  });

  it("creates the three Draft plans on apply and refuses a second apply", async () => {
    const { store, plans } = fakeStore();

    const first = await runCurriculumPlanSeed({ workbook: await seedWorkbook(), mode: "apply", store });

    expect(first.ok).toBe(true);
    expect(first.created).toEqual([
      { title: "G12 2026-27", id: 100 },
      { title: "G11 2026-27 (Others)", id: 101 },
      { title: "G11 2026-27 (HYD)", id: 102 },
    ]);
    expect(plans.map(({ title, grade, academicYear, examTracks, closureDate, chapters }) => ({
      title, grade, academicYear, examTracks, closureDate, chapters,
    }))).toEqual([
      {
        title: "G12 2026-27", grade: 12, academicYear: "2026-2027",
        examTracks: ["jee_main", "jee_advanced", "neet"], closureDate: "2026-11-30",
        chapters: [
          { chapterId: 1223, dueDate: "2026-07-10", testDate: "2026-07-09" },
          { chapterId: 1324, dueDate: "2026-07-09", testDate: "2026-07-10" },
          { chapterId: 1529, dueDate: "2026-07-08", testDate: "2026-07-10" },
        ],
      },
      {
        title: "G11 2026-27 (Others)", grade: 11, academicYear: "2026-2027",
        examTracks: ["jee_main", "jee_advanced", "neet"], closureDate: "2027-03-08",
        chapters: [{ chapterId: 1201, dueDate: "2026-07-07", testDate: "2026-07-09" }],
      },
      {
        title: "G11 2026-27 (HYD)", grade: 11, academicYear: "2026-2027",
        examTracks: ["jee_main", "jee_advanced", "neet"], closureDate: "2027-02-08",
        chapters: [{ chapterId: 1103, dueDate: "2026-06-09", testDate: null }],
      },
    ]);

    const second = await runCurriculumPlanSeed({ workbook: await seedWorkbook(), mode: "apply", store });

    expect(second.ok).toBe(false);
    expect(second.error).toBe(
      "Refusing to apply: plans already exist for 2026-2027: G12 2026-27 (Grade 12), G11 2026-27 (Others) (Grade 11), G11 2026-27 (HYD) (Grade 11)"
    );
    expect(second.created).toEqual([]);
    expect(plans).toHaveLength(3);
  });

  it("creates the three plans in one store call, so a rejected plan leaves none behind", async () => {
    const { store, plans } = fakeStore();
    store.createDraftPlans = vi.fn().mockRejectedValue(new Error('Could not create "G11 2026-27 (HYD)"'));

    await expect(
      runCurriculumPlanSeed({ workbook: await seedWorkbook(), mode: "apply", store })
    ).rejects.toThrow('Could not create "G11 2026-27 (HYD)"');
    expect(store.createDraftPlans).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.createDraftPlans).mock.calls[0][0].map((draft) => draft.title)).toEqual([
      "G12 2026-27",
      "G11 2026-27 (Others)",
      "G11 2026-27 (HYD)",
    ]);
    expect(plans).toEqual([]);
  });

  it("refuses to apply when any one of the plans already exists, creating none", async () => {
    const { store, plans } = fakeStore([{ title: "G11 2026-27 (HYD)", academicYear: "2026-2027", grade: 11 }]);

    const result = await runCurriculumPlanSeed({ workbook: await seedWorkbook(), mode: "apply", store });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Refusing to apply: plans already exist for 2026-2027: G11 2026-27 (HYD) (Grade 11)"
    );
    expect(plans).toEqual([]);
  });
});
