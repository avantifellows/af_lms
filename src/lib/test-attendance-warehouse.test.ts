import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The warehouse reads with BigQuery stubbed. The attendance read and the
// last-refreshed lookup are told apart by the table each one reads.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/bigquery", () => ({
  getBigQueryClient: () => ({ query: mockQuery }),
}));

const isMetadata = (options: { query: string }) => options.query.includes("__TABLES__");
const attendanceCalls = () => mockQuery.mock.calls.filter(([options]) => !isMetadata(options));

function answer({
  attendance = [] as unknown[],
  lastRefreshed = "2026-11-18T08:00:00.000Z" as unknown,
  attendanceError = null as Error | null,
  metadataError = null as Error | null,
} = {}) {
  mockQuery.mockImplementation(async (options: { query: string }) => {
    if (isMetadata(options)) {
      if (metadataError) throw metadataError;
      return [[{ last_refreshed: lastRefreshed }]];
    }
    if (attendanceError) throw attendanceError;
    return [attendance];
  });
}

async function freshReader() {
  vi.resetModules();
  return (await import("./test-attendance-warehouse")).readSchoolAttendance;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:30:00.000Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("readSchoolAttendance", () => {
  it("reads who opened and who submitted, with parameters, and the table's last-refreshed time", async () => {
    answer({
      attendance: [
        { user_id: 101, quiz_id: 9001, submitted: true },
        { user_id: "102", quiz_id: "9001", submitted: null },
      ],
    });
    const read = await freshReader();

    expect(await read("7", ["9001"], ["101", "102"])).toEqual({
      attendance: [
        { userId: "101", quizId: "9001", submitted: true },
        { userId: "102", quizId: "9001", submitted: null },
      ],
      lastRefreshed: "2026-11-18T08:00:00.000Z",
    });
    const [options] = attendanceCalls()[0];
    expect(options.params).toEqual({ quizIds: ["9001"], userIds: ["101", "102"] });
    expect(options.query).not.toContain("9001");
    expect(options.query).not.toContain("101");
  });

  it("asks the warehouse nothing about attendance when there are no Students or no Papers", async () => {
    answer();
    const read = await freshReader();

    expect((await read("7", [], ["101"])).attendance).toEqual([]);
    expect((await read("8", ["9001"], [])).attendance).toEqual([]);
    expect(attendanceCalls()).toHaveLength(0);
  });

  it("throws when the attendance read fails, and does not keep the failure", async () => {
    answer({ attendanceError: new Error("Unrecognized name: has_submitted") });
    const read = await freshReader();

    await expect(read("7", ["9001"], ["101"])).rejects.toThrow("Unrecognized name: has_submitted");

    answer({ attendance: [{ user_id: "101", quiz_id: "9001", submitted: false }] });
    expect((await read("7", ["9001"], ["101"])).attendance).toEqual([
      { userId: "101", quizId: "9001", submitted: false },
    ]);
  });

  it("tolerates a failed last-refreshed lookup as an unknown time, logging only the message", async () => {
    answer({ metadataError: new Error("Access Denied: __TABLES__") });
    const read = await freshReader();

    expect(await read("7", ["9001"], ["101"])).toEqual({ attendance: [], lastRefreshed: null });
    expect(console.error).toHaveBeenCalledWith(
      "Test Attendance last-refreshed lookup failed:",
      "Access Denied: __TABLES__",
    );
  });

  it("gives an unknown time when the metadata has no usable row", async () => {
    answer({ lastRefreshed: null });
    const read = await freshReader();

    expect((await read("7", ["9001"], ["101"])).lastRefreshed).toBeNull();
  });

  it("keeps a read for 60 seconds for the same School, Students and Papers, then reads again", async () => {
    answer();
    const read = await freshReader();

    await read("7", ["9001"], ["101"]);
    vi.setSystemTime(new Date("2026-11-18T08:30:59.000Z"));
    await read("7", ["9001"], ["101"]);
    expect(attendanceCalls()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-11-18T08:31:00.000Z"));
    await read("7", ["9001"], ["101"]);
    expect(attendanceCalls()).toHaveLength(2);
  });

  it("hits the cache for the same Students and Papers in another order or repeated", async () => {
    answer();
    const read = await freshReader();

    await read("7", ["9001", "9002"], ["101", "102"]);
    await read("7", ["9002", "9001", "9002"], ["102", "101", "101"]);
    expect(attendanceCalls()).toHaveLength(1);
  });

  it("reads again within 60 seconds when a Student joins the list", async () => {
    answer();
    const read = await freshReader();

    await read("7", ["9001"], ["101"]);
    await read("7", ["9001"], ["101", "102"]);
    expect(attendanceCalls()).toHaveLength(2);
    expect(attendanceCalls()[1][0].params.userIds).toEqual(["101", "102"]);
  });

  it("reads again within 60 seconds when a Paper joins the list", async () => {
    answer();
    const read = await freshReader();

    await read("7", ["9001"], ["101"]);
    await read("7", ["9001", "9002"], ["101"]);
    expect(attendanceCalls()).toHaveLength(2);
    expect(attendanceCalls()[1][0].params.quizIds).toEqual(["9001", "9002"]);
  });

  it("keeps each School apart", async () => {
    answer();
    const read = await freshReader();

    await read("7", ["9001"], ["101"]);
    await read(8, ["9001"], ["101"]);
    expect(attendanceCalls()).toHaveLength(2);
  });
});
