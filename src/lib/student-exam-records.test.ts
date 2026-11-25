import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  attachAcknowledgements,
  getExamAcknowledgement,
  listExamAcknowledgements,
} from "./student-exam-records";

const mockQuery = vi.mocked(query);

const JEE = {
  id: 10,
  exam_id: 1,
  exam_name: "JEE Mains",
  application_number: "JEE123",
  has_password: false,
  sessions_applied: [1, 2],
};
const NEET = { ...JEE, id: 11, exam_id: 2, exam_name: "NEET", sessions_applied: null };

function ackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "501",
    student_exam_record_id: "10",
    exam_session: 1,
    pages: [
      { s3_key: "k/2", page_number: 2, mime_type: "image/jpeg", byte_size: 9 },
      { s3_key: "k/1", page_number: 1, mime_type: "image/jpeg", byte_size: 9 },
    ],
    uploaded_by: "teacher@avantifellows.org",
    inserted_at: new Date("2026-11-25T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("listExamAcknowledgements", () => {
  it("reads only current acknowledgements and groups them by registration", async () => {
    mockQuery.mockResolvedValueOnce([
      ackRow(),
      ackRow({ id: "502", exam_session: 2, pages: "[]" }),
      ackRow({ id: "503", student_exam_record_id: "11", exam_session: null }),
    ]);

    const byRecord = await listExamAcknowledgements(7);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).not.toMatch(/s3_key/);
    expect(params).toEqual([7, "exam_acknowledgement"]);
    expect(byRecord.get(10)).toEqual([
      {
        id: 501,
        exam_session: 1,
        // Sorted, and without the S3 keys.
        pages: [
          { page_number: 1, mime_type: "image/jpeg" },
          { page_number: 2, mime_type: "image/jpeg" },
        ],
        uploaded_by: "teacher@avantifellows.org",
        uploaded_at: "2026-11-25T10:00:00.000Z",
      },
      expect.objectContaining({ id: 502, exam_session: 2, pages: [] }),
    ]);
    expect(byRecord.get(11)).toEqual([expect.objectContaining({ id: 503, exam_session: null })]);
  });
});

describe("attachAcknowledgements", () => {
  it("attaches each registration's acknowledgements", async () => {
    mockQuery.mockResolvedValueOnce([ackRow()]);

    const result = await attachAcknowledgements(7, [JEE, NEET]);

    expect(result.acknowledgementsAvailable).toBe(true);
    expect(result.records[0].acknowledgements.map((ack) => ack.id)).toEqual([501]);
    expect(result.records[1].acknowledgements).toEqual([]);
  });

  it("still returns the registrations when the acknowledgements can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error('column "student_exam_record_id" does not exist'));

    const result = await attachAcknowledgements(7, [JEE]);

    expect(result.acknowledgementsAvailable).toBe(false);
    expect(result.records).toEqual([{ ...JEE, acknowledgements: [] }]);
  });
});

describe("getExamAcknowledgement", () => {
  it("scopes the read to the Student, the registration and the type", async () => {
    mockQuery.mockResolvedValueOnce([ackRow()]);

    const ack = await getExamAcknowledgement(7, 10, 501);

    expect(mockQuery.mock.calls[0][1]).toEqual([501, 7, 10, "exam_acknowledgement"]);
    expect(ack?.id).toBe(501);
  });

  it("returns null when nothing matches", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await getExamAcknowledgement(7, 10, 999)).toBeNull();
  });
});
