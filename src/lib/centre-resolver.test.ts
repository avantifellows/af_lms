import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  resolveActivePhysicalCentre,
  validateCentreExamTrackMapping,
} from "./centre-resolver";

const mockQuery = vi.mocked(query);

describe("resolveActivePhysicalCentre", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the one active physical Centre for a School and Program", async () => {
    mockQuery.mockResolvedValue([{ id: "41", name: "LMS Centre" }]);

    await expect(
      resolveActivePhysicalCentre({ schoolCode: "LMS75", programId: 2 })
    ).resolves.toEqual({ ok: true, centre: { id: 41, name: "LMS Centre" } });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("centres.is_active = true"),
      ["LMS75", 2]
    );
    expect(mockQuery.mock.calls[0]?.[0]).toContain("centres.is_physical = true");
  });

  it.each([
    [[], "missing_centre", "no active physical Centre"],
    [
      [
        { id: 41, name: "First" },
        { id: 42, name: "Second" },
      ],
      "ambiguous_centre",
      "multiple active physical Centres",
    ],
  ])("returns a typed configuration error when resolution finds %# matches", async (rows, code, message) => {
    mockQuery.mockResolvedValue(rows);

    await expect(
      resolveActivePhysicalCentre({ schoolCode: "LMS75", programId: 2 })
    ).resolves.toMatchObject({ ok: false, code, error: expect.stringContaining(message) });
  });

  it("rejects a new log when the resolved Centre has no mapping for its Grade and Track", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 41, name: "LMS Centre" }])
      .mockResolvedValueOnce([]);

    await expect(
      validateCentreExamTrackMapping({
        schoolCode: "LMS75",
        programId: 2,
        grade: 11,
        examTrack: "jee_main",
      })
    ).resolves.toEqual({
      ok: false,
      error: "No Exam Tracks configured for this Centre and Grade",
    });
  });
});
