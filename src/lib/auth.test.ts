import { describe, it, expect, vi } from "vitest";
import { authOptions, DEV_LOGIN_PERSONAS } from "./auth";

// Extract providers by id
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const findProvider = (id: string) => authOptions.providers.find((p: any) => p.options?.id === id) as any;

const passcodeProvider = findProvider("passcode");
const authorize = passcodeProvider.options.authorize as (
  credentials: Record<string, string> | undefined
) => Promise<unknown>;

const devProvider = findProvider("dev-login");
const devAuthorize = devProvider?.options?.authorize as (
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

describe("Dev login provider", () => {
  it("is registered in non-production environment", () => {
    expect(devProvider).toBeDefined();
    expect(devProvider.options.id).toBe("dev-login");
  });

  it("returns user for valid admin persona", async () => {
    const result = await devAuthorize({ persona: "admin" });
    expect(result).toEqual({
      id: "dev-admin",
      email: DEV_LOGIN_PERSONAS.admin.email,
      name: "Dev Admin",
    });
  });

  it("returns user for valid program_manager persona", async () => {
    const result = await devAuthorize({ persona: "program_manager" });
    expect(result).toEqual({
      id: "dev-program_manager",
      email: DEV_LOGIN_PERSONAS.program_manager.email,
      name: "Dev PM",
    });
  });

  it("returns user for valid teacher persona", async () => {
    const result = await devAuthorize({ persona: "teacher" });
    expect(result).toEqual({
      id: "dev-teacher",
      email: DEV_LOGIN_PERSONAS.teacher.email,
      name: "Dev Teacher",
    });
  });

  it("returns user for valid read_only persona", async () => {
    const result = await devAuthorize({ persona: "read_only" });
    expect(result).toEqual({
      id: "dev-read_only",
      email: DEV_LOGIN_PERSONAS.read_only.email,
      name: "Dev Read-Only",
    });
  });

  it("returns null for unknown persona", async () => {
    const result = await devAuthorize({ persona: "superadmin" });
    expect(result).toBeNull();
  });

  it("returns null for missing persona", async () => {
    const result = await devAuthorize({});
    expect(result).toBeNull();
  });

  it("returns null for undefined credentials", async () => {
    const result = await devAuthorize(undefined);
    expect(result).toBeNull();
  });
});
