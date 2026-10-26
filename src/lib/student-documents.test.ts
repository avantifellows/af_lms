import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { listDocumentTypesForStudents } from "./student-documents";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe("listDocumentTypesForStudents", () => {
  it("asks for every Student's types in one query, excluding deleted rows", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await listDocumentTypesForStudents([3, 1, 2]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM lms_student_documents");
    expect(sql).toContain("student_id = ANY($1::bigint[])");
    expect(sql).toContain("deleted_at IS NULL");
    expect(params).toEqual([[3, 1, 2]]);
  });

  it("groups the types by Student", async () => {
    mockQuery.mockResolvedValueOnce([
      { student_id: "1", document_type: "parent_undertaking" },
      { student_id: 1, document_type: "caste_certificate" },
      { student_id: "2", document_type: "student_photograph" },
    ]);

    const byStudent = await listDocumentTypesForStudents([1, 2]);

    expect(byStudent.get(1)).toEqual(["parent_undertaking", "caste_certificate"]);
    expect(byStudent.get(2)).toEqual(["student_photograph"]);
  });

  it("leaves out a type the LMS does not offer", async () => {
    mockQuery.mockResolvedValueOnce([
      { student_id: "1", document_type: "some_legacy_type" },
      { student_id: "1", document_type: "income_certificate" },
    ]);

    expect((await listDocumentTypesForStudents([1])).get(1)).toEqual([
      "income_certificate",
    ]);
  });

  it("asks nothing when there are no Students, rather than ANY('{}')", async () => {
    expect((await listDocumentTypesForStudents([])).size).toBe(0);
    expect(await listDocumentTypesForStudents([0, -1, Number.NaN])).toEqual(
      new Map(),
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("asks for each Student once, however many times the caller lists them", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await listDocumentTypesForStudents([1, 1, 2]);

    expect(mockQuery.mock.calls[0][1]).toEqual([[1, 2]]);
  });
});
