import { describe, it, expect, vi } from "vitest";
import { authOptions } from "./auth";

// Extract the credentials provider and callbacks
// In NextAuth v4, the user's authorize fn is under options.authorize
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const credentialsProvider = authOptions.providers.find((p: any) => p.type === "credentials") as any;
const authorize = credentialsProvider.options.authorize as (
  credentials: Record<string, string> | undefined
) => Promise<unknown>;
const jwtCallback = authOptions.callbacks!.jwt!;
const sessionCallback = authOptions.callbacks!.session!;

describe("Credentials provider authorize", () => {
  it("returns pseudo-user for valid passcode", async () => {
    // Uses real getSchoolByPasscode — "70705123" maps to school "70705"
    const result = await authorize({ passcode: "70705123" });
    expect(result).toEqual({
      id: "passcode-70705",
      email: "passcode-70705@school.local",
      name: "School 70705",
      schoolCode: "70705",
    });
  });

  it("returns null for invalid passcode", async () => {
    const result = await authorize({ passcode: "00000000" });
    expect(result).toBeNull();
  });

  it("returns null for undefined credentials", async () => {
    const result = await authorize(undefined);
    expect(result).toBeNull();
  });

  it("returns null for missing passcode field", async () => {
    const result = await authorize({});
    expect(result).toBeNull();
  });
});

describe("jwt callback", () => {
  it("adds schoolCode and isPasscodeUser for passcode user", async () => {
    const token = { sub: "123" };
    const user = { id: "passcode-70705", schoolCode: "70705" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (jwtCallback as any)({ token, user, account: null, profile: undefined });
    expect(result.schoolCode).toBe("70705");
    expect(result.isPasscodeUser).toBe(true);
  });

  it("does not modify token for Google user", async () => {
    const token = { sub: "456", email: "user@avantifellows.org" };
    const user = { id: "google-456" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (jwtCallback as any)({ token, user, account: null, profile: undefined });
    expect(result.schoolCode).toBeUndefined();
    expect(result.isPasscodeUser).toBeUndefined();
  });
});

describe("session callback", () => {
  it("adds schoolCode and isPasscodeUser from token to session", async () => {
    const session = { user: { name: "School 70705" }, expires: "2025-12-31" };
    const token = { sub: "123", schoolCode: "70705", isPasscodeUser: true };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (sessionCallback as any)({ session, token, user: undefined as any });
    expect(result.schoolCode).toBe("70705");
    expect(result.isPasscodeUser).toBe(true);
  });

  it("does not modify session when token has no schoolCode", async () => {
    const session = { user: { name: "Admin User" }, expires: "2025-12-31" };
    const token = { sub: "456", email: "admin@avantifellows.org" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (sessionCallback as any)({ session, token, user: undefined as any });
    expect(result.schoolCode).toBeUndefined();
    expect(result.isPasscodeUser).toBeUndefined();
  });
});
