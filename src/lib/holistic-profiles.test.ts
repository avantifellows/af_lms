import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ withTransaction: vi.fn(), query: vi.fn() }));
vi.mock("./holistic-reconciliation", () => ({ reconcileHolisticMappings: vi.fn() }));

import { query, withTransaction } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import { getHolisticProfileAdmin, requestHolisticProfileRegeneration } from "./holistic-profiles";

const mockTransaction = vi.mocked(withTransaction);
const mockQuery = vi.mocked(query);
const mockReconcile = vi.mocked(reconcileHolisticMappings);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const requestKey = "d16e7d82-dc60-4b79-a064-9ed80badc119";
const regenerationRequest = {
  email: "admin@example.com",
  studentId: 41,
  requestKey,
  force: true,
};

function mockRegenerationClient(
  scopeRows: Array<Record<string, unknown>>,
  requestRows: Array<Record<string, unknown>> = []
) {
  const client = { query: vi.fn()
    .mockResolvedValueOnce({ rows: scopeRows })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: requestRows }) };
  mockTransaction.mockImplementation(async (callback) => callback(client as never));
  return client;
}

describe("Holistic Profile regeneration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReconcile.mockResolvedValue(0);
    process.env.APP_ENV = "staging";
    process.env.HOLISTIC_PROFILE_ETL_URL = "https://etl.example.test/api/internal/holistic-profiles/regeneration-requests/";
    process.env.HOLISTIC_PROFILE_ETL_TOKEN = "machine-token";
  });

  it("parameterizes the current-year active-Mapping rule for Profile reads", async () => {
    mockQuery.mockResolvedValue([]);

    await getHolisticProfileAdmin(41, "2026-2027");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][1]).toEqual([41, 1, "2026-2027", "2026-2027"]);
    expect(mockQuery.mock.calls[1][1]).toEqual([41, 1, "2026-2027", "2026-2027"]);
    expect(mockQuery.mock.calls[1][0]).toContain("configuration.state = 'active'");
    expect(mockQuery.mock.calls[1][0]).toContain("configuration.id = request.prompt_configuration_id");
    expect(mockQuery.mock.calls[0][0]).toContain("FROM student live_student");
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      studentIds: [41],
    });
  });

  it("records actor, Student, Active configuration and force before sending only the request reference", async () => {
    const client = mockRegenerationClient(
      [{ actor_user_id: "9", student_id: "41", prompt_configuration_id: "6" }],
      [{ request_key: requestKey, state: "queued" }]
    );
    mockFetch.mockResolvedValue(new Response(null, { status: 202 }));

    const result = await requestHolisticProfileRegeneration(regenerationRequest);

    expect(client.query.mock.calls[1]).toEqual([
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`holistic_profile_regeneration:${requestKey}`],
    ]);
    expect(client.query.mock.calls[2][1]).toEqual([
      "d16e7d82-dc60-4b79-a064-9ed80badc119", 9, 41, 6, true,
    ]);
    const scopeSql = String(client.query.mock.calls[0][0]);
    expect(scopeSql).toContain("permission.read_only IS NOT TRUE");
    expect(scopeSql).toContain("permission.role IN ('admin', 'holistic_mentorship_admin')");
    expect(scopeSql).toContain("student.status IS DISTINCT FROM 'dropout'");
    expect(scopeSql).toContain("batch.program_id = $3");
    expect(scopeSql).toContain("grade.number IN (11, 12)");
    expect(scopeSql).toContain("holistic_mentorship_privacy_deletions");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://etl.example.test/api/internal/holistic-profiles/regeneration-requests/d16e7d82-dc60-4b79-a064-9ed80badc119/enqueue",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer machine-token" }),
        body: JSON.stringify({ environment: "staging" }),
      })
    );
    expect(result).toEqual({ ok: true, requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued" });
  });

  it("does not create or enqueue regeneration after an approved privacy deletion", async () => {
    const client = mockRegenerationClient([]);

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Student or Active Profile configuration not found",
    });

    expect(client.query).toHaveBeenCalledOnce();
    expect(client.query.mock.calls[0][0]).toContain("holistic_mentorship_privacy_deletions");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed before writing when the ETL environment is not configured", async () => {
    process.env.APP_ENV = "dev";

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: false,
      status: 500,
      error: "Profile regeneration is not configured",
    });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps ambiguous delivery queued for a same-key retry", async () => {
    mockRegenerationClient(
      [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }],
      [{ request_key: requestKey, state: "queued" }]
    );
    mockFetch.mockRejectedValue(new TypeError("network failure"));

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: true, requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued", delivery: "ambiguous",
    });
  });

  it("does not enqueue an already-running idempotent request again", async () => {
    mockRegenerationClient(
      [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }],
      [{ request_key: requestKey, state: "running" }]
    );

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: true, requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "running",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key for a different request", async () => {
    mockRegenerationClient([
      { actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 },
    ]);

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Idempotency key conflict",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("records a confirmed enqueue rejection without changing the successful Profile", async () => {
    mockRegenerationClient(
      [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }],
      [{ request_key: requestKey, state: "queued" }]
    );
    mockFetch.mockResolvedValue(new Response(null, { status: 400 }));
    mockQuery.mockResolvedValue([{ request_key: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "failed" }]);

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: false,
      status: 502,
      error: "Profile regeneration was rejected",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery.mock.calls[0][0]).toContain("UPDATE holistic_mentorship_regeneration_requests");
    expect(mockQuery.mock.calls[0][0]).toContain("etl_run_id IS NULL");
    expect(mockQuery.mock.calls[0][0]).not.toContain("student_profiles");
  });

  it.each([302, 408, 429, 503])(
    "keeps a non-permanent ETL status %i queued without terminalizing the request",
    async (status) => {
      mockRegenerationClient(
        [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }],
        [{ request_key: requestKey, state: "queued" }]
      );
      mockFetch.mockResolvedValue(new Response(null, { status }));

      await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
        ok: true, requestKey, state: "queued", delivery: "ambiguous",
      });
      expect(mockQuery).not.toHaveBeenCalled();
    }
  );

  it("retries the same queued request key after a transient ETL rejection", async () => {
    const first = mockRegenerationClient(
      [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }],
      [{ request_key: requestKey, state: "queued" }]
    );
    const second = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ request_key: requestKey, state: "queued" }] }) };
    mockTransaction
      .mockImplementationOnce(async (callback) => callback(first as never))
      .mockImplementationOnce(async (callback) => callback(second as never));
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toMatchObject({
      ok: true, delivery: "ambiguous",
    });
    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: true, requestKey, state: "queued",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a request that ETL bound before a permanent rejection arrived", async () => {
    mockRegenerationClient(
      [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }],
      [{ request_key: requestKey, state: "queued" }]
    );
    mockFetch.mockResolvedValue(new Response(null, { status: 409 }));
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ request_key: requestKey, state: "running" }]);

    await expect(requestHolisticProfileRegeneration(regenerationRequest)).resolves.toEqual({
      ok: true, requestKey, state: "running",
    });

    expect(mockQuery.mock.calls[0][0]).toContain("etl_run_id IS NULL");
    expect(mockQuery.mock.calls[1][0]).toContain("SELECT request_key, state");
  });
});
