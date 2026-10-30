import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./permissions", () => ({ getResolvedPermission: vi.fn() }));
vi.mock("./holistic-mentorship", () => ({ requireHolisticMentorshipAccess: vi.fn() }));

import { query } from "./db";
import { getResolvedPermission } from "./permissions";
import { requireHolisticMentorshipAccess } from "./holistic-mentorship";
import { getMentorNoteCounts, getMentorNotes, groupInteractions } from "./student-support-notes";

const mockQuery = vi.mocked(query);
const mockPermission = vi.mocked(getResolvedPermission);
const mockAccess = vi.mocked(requireHolisticMentorshipAccess);

const SESSION = { user: { email: "t@avantifellows.org" } };
const SCHOOL = { id: 4, code: "70705", name: "JNV", region: null, programId: 1 };
const allowed = (extra: object = {}) =>
  ({ ok: true, email: "t@avantifellows.org", permission: {}, canEdit: false, programId: 1, school: SCHOOL, ...extra }) as never;

beforeEach(() => vi.resetAllMocks());

describe("getMentorNoteCounts", () => {
  it("asks a teacher for roster_view, and keeps only their own mentees", async () => {
    mockPermission.mockResolvedValue({ role: "teacher" } as never);
    mockAccess.mockResolvedValue(allowed({ actorUserId: 9 }));
    mockQuery.mockResolvedValue([{ uid: "101", notes: "3" }]);

    await expect(getMentorNoteCounts(SESSION, "70705", "JNV CoE", 12)).resolves.toEqual({ "101": 3 });
    expect(mockAccess).toHaveBeenCalledWith(SESSION, "roster_view", { schoolCode: "70705", programId: 1 });
    // The mentor filter is the last parameter.
    expect(mockQuery.mock.calls[0][1]?.at(-1)).toBe(9);
  });

  it("gives program roles the whole grade, with no mentor filter", async () => {
    mockPermission.mockResolvedValue({ role: "program_manager" } as never);
    mockAccess.mockResolvedValue(allowed());
    mockQuery.mockResolvedValue([]);

    await getMentorNoteCounts(SESSION, "70705", "JNV CoE", 11);
    expect(mockAccess).toHaveBeenCalledWith(SESSION, "mapped_student_read", { schoolCode: "70705", programId: 1 });
    expect(mockQuery.mock.calls[0][1]?.at(-1)).toBeNull();
  });

  it("asks the gate for the program being viewed, so a School in two Holistic programs still answers", async () => {
    mockPermission.mockResolvedValue({ role: "admin" } as never);
    mockAccess.mockResolvedValue(allowed({ programId: 74, school: { ...SCHOOL, programId: 74 } }));
    mockQuery.mockResolvedValue([{ uid: "101", notes: 1 }]);

    await expect(getMentorNoteCounts(SESSION, "70705", "Punjab CoE", 12)).resolves.toEqual({ "101": 1 });
    expect(mockAccess).toHaveBeenCalledWith(SESSION, "mapped_student_read", { schoolCode: "70705", programId: 74 });
    expect(mockQuery.mock.calls[0][1]?.[1]).toBe(74);
  });

  it("returns no counts for a program that isn't a Holistic Mentorship program", async () => {
    mockPermission.mockResolvedValue({ role: "admin" } as never);
    mockAccess.mockResolvedValue(allowed());

    await expect(getMentorNoteCounts(SESSION, "70705", "JNV Nodal", 12)).resolves.toEqual({});
    await expect(getMentorNoteCounts(SESSION, "70705", "Not a program", 12)).resolves.toEqual({});
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("counts an imported note only when it has answers, as the list shows it", async () => {
    mockPermission.mockResolvedValue({ role: "admin" } as never);
    mockAccess.mockResolvedValue(allowed());
    mockQuery.mockResolvedValue([]);

    await getMentorNoteCounts(SESSION, "70705", "JNV CoE", 12);
    const sql = mockQuery.mock.calls[0][0].replace(/\s+/g, " ");
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM holistic_mentorship_historical_note_answers answer WHERE answer.historical_note_id = historical.id)"
    );
  });

  it("reveals nothing when the Holistic gate refuses", async () => {
    mockPermission.mockResolvedValue({ role: "teacher" } as never);
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    await expect(getMentorNoteCounts(SESSION, "70705", "JNV CoE", 12)).resolves.toEqual({});
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("getMentorNotes", () => {
  it("makes the per-student Holistic check before reading", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 41 }]);
    mockPermission.mockResolvedValue({ role: "teacher" } as never);
    mockAccess
      .mockResolvedValueOnce(allowed({ actorUserId: 9 }))
      .mockResolvedValueOnce({ ok: false, status: 404, error: "Not found" });

    await expect(getMentorNotes(SESSION, "70705", "JNV CoE", "101")).resolves.toBeNull();
    expect(mockAccess).toHaveBeenLastCalledWith(SESSION, "mapped_student_read", expect.objectContaining({
      schoolCode: "70705",
      studentId: 41,
      programId: 1,
    }));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns the student's interactions when allowed", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 41 }])
      .mockResolvedValueOnce([
        { id: "n2", title: "Phase 2", date: "2026-10-01", mentor: "A B", question: "Q1", answer: "yes", position: 1 },
      ]);
    mockPermission.mockResolvedValue({ role: "admin" } as never);
    mockAccess.mockResolvedValue(allowed());

    await expect(getMentorNotes(SESSION, "70705", "JNV CoE", "101")).resolves.toEqual([
      { title: "Phase 2", date: "2026-10-01", mentor: "A B", answers: [{ question: "Q1", answer: "yes" }] },
    ]);
  });

  it("asks both gates for the program being viewed", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 41 }]).mockResolvedValueOnce([]);
    mockPermission.mockResolvedValue({ role: "teacher" } as never);
    mockAccess.mockResolvedValue(allowed({ actorUserId: 9, programId: 74, school: { ...SCHOOL, programId: 74 } }));

    await expect(getMentorNotes(SESSION, "70705", "Punjab CoE", "101")).resolves.toEqual([]);
    expect(mockAccess).toHaveBeenNthCalledWith(1, SESSION, "roster_view", { schoolCode: "70705", programId: 74 });
    expect(mockAccess).toHaveBeenNthCalledWith(2, SESSION, "mapped_student_read", expect.objectContaining({ programId: 74 }));
  });

  it("answers null for a program that isn't a Holistic Mentorship program", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 41 }]);
    await expect(getMentorNotes(SESSION, "70705", "JNV Nodal", "101")).resolves.toBeNull();
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("answers null for an unknown student without asking the gate", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(getMentorNotes(SESSION, "70705", "JNV CoE", "101")).resolves.toBeNull();
    expect(mockAccess).not.toHaveBeenCalled();
  });
});

describe("groupInteractions", () => {
  it("groups answers per interaction in query order, and labels imported notes", () => {
    const rows = [
      { id: "n2", title: "Phase 2", date: "2026-10-01", mentor: "A", question: "Q1", answer: "a", position: 1 },
      { id: "n2", title: "Phase 2", date: "2026-10-01", mentor: "A", question: "Q2", answer: null, position: 2 },
      { id: "n1", title: "Phase 1", date: "2026-08-01", mentor: "A", question: "Q1", answer: "b", position: 1 },
      { id: "h7", title: null, date: null, mentor: null, question: "Old", answer: "c", position: 1 },
    ];
    const out = groupInteractions(rows);
    expect(out.map((i) => i.title)).toEqual(["Phase 2", "Phase 1", "Earlier notes (imported)"]);
    expect(out[0].answers).toEqual([{ question: "Q1", answer: "a" }, { question: "Q2", answer: null }]);
  });
});
