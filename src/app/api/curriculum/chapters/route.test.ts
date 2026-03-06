import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { GET } from "./route";
import { NO_SESSION, ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

function nextReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost"));
}

describe("GET /api/curriculum/chapters", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const res = await GET(nextReq("/api/curriculum/chapters"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid grade", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const res = await GET(nextReq("/api/curriculum/chapters?grade=9"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Grade must be 11 or 12");
  });

  it("returns 400 for invalid subject", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const res = await GET(nextReq("/api/curriculum/chapters?subject=Biology"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Subject must be");
  });

  it("returns chapters with topics for valid params", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const chapters = [
      { id: 1, code: "CH1", name: [{ lang_code: "en", chapter: "Kinematics" }], grade_id: 3, grade_number: 11, subject_id: 4, subject_name: [{ lang_code: "en", subject: "Physics" }] },
    ];
    const topics = [
      { id: 10, code: "T1", name: [{ lang_code: "en", topic: "Speed" }], chapter_id: 1 },
    ];
    mockQuery
      .mockResolvedValueOnce(chapters) // chapters query
      .mockResolvedValueOnce(topics); // topics query

    const res = await GET(nextReq("/api/curriculum/chapters?grade=11&subject=Physics"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.chapters).toHaveLength(1);
    expect(json.chapters[0].name).toBe("Kinematics");
    expect(json.chapters[0].topics).toHaveLength(1);
    expect(json.chapters[0].topics[0].name).toBe("Speed");
  });

  it("defaults to grade 11 and Physics when no params", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce([]) // no chapters
      .mockResolvedValueOnce([]); // won't be called but mock anyway

    const res = await GET(nextReq("/api/curriculum/chapters"));
    expect(res.status).toBe(200);
    // gradeId=3 (11), subjectId=4 (Physics)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE ch.grade_id = $1 AND ch.subject_id = $2"),
      [3, 4],
    );
  });

  it("skips topics query when no chapters found", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce([]); // no chapters

    const res = await GET(nextReq("/api/curriculum/chapters?grade=12&subject=Maths"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.chapters).toEqual([]);
    // Only 1 query (chapters), topics query skipped
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("handles string JSONB names gracefully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const chapters = [
      { id: 2, code: "CH2", name: JSON.stringify([{ lang_code: "en", chapter: "Optics" }]), grade_id: 3, grade_number: 11, subject_id: 4, subject_name: JSON.stringify([{ lang_code: "en", subject: "Physics" }]) },
    ];
    mockQuery
      .mockResolvedValueOnce(chapters)
      .mockResolvedValueOnce([]);

    const res = await GET(nextReq("/api/curriculum/chapters?grade=11&subject=Physics"));
    const json = await res.json();
    expect(json.chapters[0].name).toBe("Optics");
  });

  it("returns 'Unknown' when JSONB name is not an array", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const chapters = [
      { id: 3, code: "CH3", name: { not: "an array" }, grade_id: 3, grade_number: 11, subject_id: 4, subject_name: 42 },
    ];
    mockQuery
      .mockResolvedValueOnce(chapters)
      .mockResolvedValueOnce([]);

    const res = await GET(nextReq("/api/curriculum/chapters?grade=11&subject=Physics"));
    const json = await res.json();
    expect(json.chapters[0].name).toBe("Unknown chapter");
    expect(json.chapters[0].subjectName).toBe("Unknown subject");
  });

  it("returns 'Unknown' when JSONB string is invalid JSON", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const chapters = [
      { id: 4, code: "CH4", name: "not valid json{", grade_id: 3, grade_number: 11, subject_id: 4, subject_name: "also{bad" },
    ];
    mockQuery
      .mockResolvedValueOnce(chapters)
      .mockResolvedValueOnce([]);

    const res = await GET(nextReq("/api/curriculum/chapters?grade=11&subject=Physics"));
    const json = await res.json();
    expect(json.chapters[0].name).toBe("Unknown chapter");
    expect(json.chapters[0].subjectName).toBe("Unknown subject");
  });

  it("returns 500 on query error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockRejectedValue(new Error("DB error"));

    const res = await GET(nextReq("/api/curriculum/chapters"));
    expect(res.status).toBe(500);
  });
});
