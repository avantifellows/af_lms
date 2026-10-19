import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("./db", () => ({ query: mockQuery }));

import { loadChapterTestSessions } from "./curriculum-chapter-tests";

beforeEach(() => {
  vi.resetAllMocks();
  mockQuery.mockResolvedValue([]);
});

describe("loadChapterTestSessions", () => {
  it("reads nothing without Centres", async () => {
    const sessions = await loadChapterTestSessions({
      centreIds: [],
      grade: 11,
      academicYear: "2026-2027",
      asOf: "2026-08-15",
    });

    expect(sessions.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("groups end times by Centre and Chapter", async () => {
    mockQuery.mockResolvedValue([
      { centre_id: "11", chapter_id: "501", session_id: 1, end_time: "2026-07-02 11:00:00" },
      { centre_id: "11", chapter_id: "501", session_id: 2, end_time: null },
      { centre_id: "11", chapter_id: "502", session_id: 3, end_time: "2026-07-20 11:00:00" },
      { centre_id: 12, chapter_id: 501, session_id: 1, end_time: "2026-07-02 11:00:00" },
    ]);

    const sessions = await loadChapterTestSessions({
      centreIds: [11, 12],
      grade: 11,
      academicYear: "2026-2027",
      asOf: "2026-08-15",
    });

    expect(sessions).toEqual(
      new Map([
        [
          11,
          new Map([
            [501, ["2026-07-02 11:00:00", null]],
            [502, ["2026-07-20 11:00:00"]],
          ]),
        ],
        [12, new Map([[501, ["2026-07-02 11:00:00"]]])],
      ])
    );
  });

  // as_of 1 Feb 2027 viewed in Oct 2027 must not count a July 2027 session: sessions are bounded
  // to the as-of date's academic year, and to those created or started by the end of as-of.
  it("bounds sessions to the academic year and to what existed by the as-of date", async () => {
    await loadChapterTestSessions({
      centreIds: [11],
      grade: 11,
      academicYear: "2026-2027",
      asOf: "2027-02-01",
    });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([[11], 11, "2026-04-01", "2027-03-31", "2027-02-01"]);
    expect(sql).toContain("s.start_time >= $3::date");
    expect(sql).toContain("s.start_time < $4::date + 1");
    expect(sql).toMatch(
      /LEAST\(\s*s\.start_time,\s*s\.inserted_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia\/Kolkata'\s*\) < \$5::date \+ 1/
    );
  });

  it("finds the majority Chapter after unifying duplicate Chapter rows", async () => {
    await loadChapterTestSessions({
      centreIds: [11],
      grade: 11,
      academicYear: "2026-2027",
      asOf: "2026-08-15",
    });

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    const majority = sql.slice(sql.indexOf("resource_chapter rc"), sql.indexOf("LIMIT 1", sql.indexOf("resource_chapter rc")));
    expect(majority).toContain("GROUP BY majority.code, majority.subject_id, majority.grade_id");
    expect(majority).not.toContain("GROUP BY rc.chapter_id");
  });
});
