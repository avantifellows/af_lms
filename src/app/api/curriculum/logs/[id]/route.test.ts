import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/permissions", () => {
  const getUserPermission = vi.fn();
  return {
    PROGRAM_IDS: { COE: 1, NODAL: 2, NVS: 64 },
    getFeatureAccess: vi.fn(),
    getUserPermission,
    getResolvedPermission: getUserPermission,
    canAccessSchoolSync: vi.fn(),
  };
});

import { getServerSession } from "next-auth";
import { query, withTransaction } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import {
  PASSCODE_SESSION,
  TEACHER_SESSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";
import { resetCurriculumSchemaCheckForTests } from "@/lib/curriculum-schema";
import { DELETE, PATCH } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

function jsonReq(body: unknown) {
  return new NextRequest(
    new URL("/api/curriculum/logs/12", "http://localhost"),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function deleteReq() {
  return new NextRequest(
    new URL("/api/curriculum/logs/12", "http://localhost"),
    { method: "DELETE" }
  );
}

const teacherPermission = {
  email: "teacher@avantifellows.org",
  level: 1 as const,
  role: "teacher" as const,
  school_codes: ["70705"],
  regions: null,
  program_ids: [1],
  read_only: false,
};

const editableLogRow = {
  id: 12,
  school_code: "70705",
  program_id: 1,
  grade_id: 3,
  subject_id: 4,
  exam_track: "jee_main",
  is_editable: true,
};

const updatedLogRows = [
  {
    id: 12,
    log_date: "2026-02-16",
    duration_minutes: 120,
    program_id: 1,
    grade_id: 3,
    subject_id: 4,
    exam_track: "jee_main",
    inserted_at: "2026-02-15T10:00:00.000Z",
    updated_at: "2026-02-16T10:00:00.000Z",
    topic_id: 102,
    topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
    chapter_id: 1,
    chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
    topic_currently_in_syllabus: true,
  },
];

describe("PATCH /api/curriculum/logs/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCurriculumSchemaCheckForTests();
    mockSession.mockResolvedValue(TEACHER_SESSION);
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockCanAccessSchoolSync.mockReturnValue(true);
  });

  it("edits one LMS Curriculum Log by replacing its full topic set in a transaction", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          topic_id: 102,
          topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ])
      .mockResolvedValueOnce(updatedLogRows);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE lms_curriculum_logs"),
      [12, "2026-02-16", 120, "teacher@avantifellows.org"]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("DELETE FROM lms_curriculum_log_topics"),
      [12]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO lms_curriculum_log_topics"),
      [12, [102]]
    );
    await expect(res.json()).resolves.toMatchObject({
      log: {
        id: 12,
        logDate: "2026-02-16",
        durationMinutes: 120,
        topics: [{ topicId: 102, topicName: "Projectile Motion" }],
        isEditable: true,
      },
    });
  });

  it("rejects scope fields and Chapter Completion deltas in edit requests", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
        school_code: "70705",
        complete_chapter_ids: [1],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Only log_date, duration_minutes, and topic_ids can be updated",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("requires at least one replacement topic", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "At least one topic is required",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects edits to historical LMS Curriculum Logs", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...editableLogRow, is_editable: false }])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Historical LMS Curriculum Logs are not editable",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects users without Curriculum edit access before loading the log", async () => {
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects passcode users before loading the log", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockGetUserPermission).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-school log ID edits by the stored row scope", async () => {
    mockCanAccessSchoolSync.mockReturnValue(false);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-program log ID edits by the stored row Program", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [2] }])
      .mockResolvedValueOnce([{ id: 2, name: "JNV Nodal" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects duration bounds and future IST dates before opening a transaction", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await PATCH(
      jsonReq({
        log_date: "2999-01-01",
        duration_minutes: 721,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Log date cannot be in the future",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects replacement topics outside the loaded log Exam Track and scope", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [999],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Topics do not belong to the LMS Curriculum Log scope",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns not found for missing or deleted logs", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "LMS Curriculum Log not found",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("lets the transaction helper roll back a failed replacement and does not read an updated log", async () => {
    mockWithTransaction.mockRejectedValue(new Error("insert failed"));
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          topic_id: 102,
          topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ]);

    await expect(
      PATCH(
        jsonReq({
          log_date: "2026-02-16",
          duration_minutes: 120,
          topic_ids: [102],
        }),
        routeParams({ id: "12" })
      )
    ).rejects.toThrow("insert failed");

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("does not rewrite topic rows if the log is concurrently soft-deleted before update", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          topic_id: 102,
          topic_name: [{ lang_code: "en", topic: "Projectile Motion" }],
          chapter_id: 1,
          chapter_name: [{ lang_code: "en", chapter: "Kinematics" }],
        },
      ]);

    const res = await PATCH(
      jsonReq({
        log_date: "2026-02-16",
        duration_minutes: 120,
        topic_ids: [102],
      }),
      routeParams({ id: "12" })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "LMS Curriculum Log not found",
    });
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM lms_curriculum_log_topics"),
      expect.anything()
    );
  });
});

describe("DELETE /api/curriculum/logs/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCurriculumSchemaCheckForTests();
    mockSession.mockResolvedValue(TEACHER_SESSION);
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockCanAccessSchoolSync.mockReturnValue(true);
  });

  it("soft-deletes one LMS Curriculum Log after verifying the stored row scope", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: clientQuery } as never)
    );
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET deleted_at = (NOW() AT TIME ZONE 'UTC')"),
      [12, "teacher@avantifellows.org"]
    );
    await expect(res.json()).resolves.toEqual({ deleted: true });
  });

  it("rejects users without Curriculum edit access before loading the log", async () => {
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects passcode users before loading the log", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockGetUserPermission).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-school deletes by the stored row scope", async () => {
    mockCanAccessSchoolSync.mockReturnValue(false);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [1] }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-program deletes by the stored row Program", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([editableLogRow])
      .mockResolvedValueOnce([{ code: "70705", region: "North", program_ids: [2] }])
      .mockResolvedValueOnce([{ id: 2, name: "JNV Nodal" }]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns not found for missing or already-deleted logs", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await DELETE(deleteReq(), routeParams({ id: "12" }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "LMS Curriculum Log not found",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
