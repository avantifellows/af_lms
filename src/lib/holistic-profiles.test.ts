import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ withTransaction: vi.fn(), query: vi.fn() }));

import { query, withTransaction } from "./db";
import { getHolisticProfileAdmin, requestHolisticProfileRegeneration } from "./holistic-profiles";

const mockTransaction = vi.mocked(withTransaction);
const mockQuery = vi.mocked(query);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Holistic Profile regeneration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.HOLISTIC_PROFILE_ETL_URL = "https://etl.example.test/holistic/regenerate";
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
  });

  it("records actor, Student, Active configuration and force before sending only the request reference", async () => {
    const client = { query: vi.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ actor_user_id: "9", student_id: "41", prompt_configuration_id: "6" }] })
      .mockResolvedValueOnce({ rows: [{ request_key: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued" }] });
    mockTransaction.mockImplementation(async (callback) => callback(client as never));
    mockFetch.mockResolvedValue(new Response(null, { status: 202 }));

    const result = await requestHolisticProfileRegeneration({
      email: "admin@example.com",
      studentId: 41,
      requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119",
      force: true,
    });

    expect(client.query.mock.calls[1][1]).toEqual([
      "d16e7d82-dc60-4b79-a064-9ed80badc119", 9, 41, 6, true,
    ]);
    expect(client.query.mock.calls[0][0]).toContain("permission.read_only IS NOT TRUE");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://etl.example.test/holistic/regenerate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer machine-token" }),
        body: JSON.stringify({ request_key: "d16e7d82-dc60-4b79-a064-9ed80badc119" }),
      })
    );
    expect(result).toEqual({ ok: true, requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued" });
  });

  it("keeps ambiguous delivery queued for a same-key retry", async () => {
    const client = { query: vi.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }] })
      .mockResolvedValueOnce({ rows: [{ request_key: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued" }] });
    mockTransaction.mockImplementation(async (callback) => callback(client as never));
    mockFetch.mockRejectedValue(new TypeError("network failure"));

    await expect(requestHolisticProfileRegeneration({
      email: "admin@example.com", studentId: 41,
      requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", force: true,
    })).resolves.toEqual({
      ok: true, requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued", delivery: "ambiguous",
    });
  });

  it("records a confirmed enqueue rejection without changing the successful Profile", async () => {
    const client = { query: vi.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ actor_user_id: 9, student_id: 41, prompt_configuration_id: 6 }] })
      .mockResolvedValueOnce({ rows: [{ request_key: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued" }] });
    mockTransaction.mockImplementation(async (callback) => callback(client as never));
    mockFetch.mockResolvedValue(new Response(null, { status: 400 }));
    mockQuery.mockResolvedValue([]);

    await expect(requestHolisticProfileRegeneration({
      email: "admin@example.com", studentId: 41,
      requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", force: true,
    })).resolves.toEqual({ ok: false, status: 502, error: "Profile regeneration was rejected" });

    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery.mock.calls[0][0]).toContain("UPDATE holistic_mentorship_regeneration_requests");
    expect(mockQuery.mock.calls[0][0]).not.toContain("student_profiles");
  });
});
