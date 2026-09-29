import { describe, it, expect } from "vitest";
import { authOptions, DEV_LOGIN_PERSONAS } from "./auth";

// Extract providers by id
const findProvider = (id: string) => authOptions.providers.find((p: any) => p.options?.id === id) as any;

const devProvider = findProvider("dev-login");
const devAuthorize = devProvider?.options?.authorize as (
  credentials: Record<string, string> | undefined
) => Promise<unknown>;
const jwtCallback = authOptions.callbacks!.jwt!;

describe("providers", () => {
  it("does not register a passcode provider", () => {
    expect(findProvider("passcode")).toBeUndefined();
  });
});

describe("jwt callback", () => {
  const runJwt = (token: Record<string, unknown>, user?: Record<string, unknown>) =>
    (jwtCallback as any)({ token, user, account: null, profile: undefined });

  it("rejects a token carrying the isPasscodeUser marker", async () => {
    await expect(
      runJwt({ sub: "x", email: "someone@gmail.com", isPasscodeUser: true })
    ).rejects.toThrow();
  });

  it("rejects a token carrying a schoolCode claim", async () => {
    await expect(
      runJwt({ sub: "x", email: "someone@gmail.com", schoolCode: "70705" })
    ).rejects.toThrow();
  });

  it("rejects a token whose email is a passcode pseudo-user", async () => {
    await expect(
      runJwt({ sub: "passcode-70705", email: "passcode-70705@school.local" })
    ).rejects.toThrow();
  });

  it("rejects a passcode pseudo-user email in any case", async () => {
    await expect(
      runJwt({ sub: "passcode-70705", email: "PassCode-70705@School.LOCAL" })
    ).rejects.toThrow();
  });

  it("returns a Google token unchanged", async () => {
    const token = { sub: "456", email: "user@avantifellows.org", name: "User" };
    const result = await runJwt(token, { id: "google-456" });
    expect(result).toEqual({ sub: "456", email: "user@avantifellows.org", name: "User" });
  });

  it("returns a Dev Login token unchanged", async () => {
    const token = { sub: "dev-admin", email: "e2e-holistic-global-admin@test.local", name: "Dev Admin" };
    const result = await runJwt(token, { id: "dev-admin" });
    expect(result).toEqual({
      sub: "dev-admin",
      email: "e2e-holistic-global-admin@test.local",
      name: "Dev Admin",
    });
  });

  it("accepts a Google account on any domain", async () => {
    const result = await runJwt({ sub: "789", email: "stakeholder@gmail.com" });
    expect(result).toEqual({ sub: "789", email: "stakeholder@gmail.com" });
  });

  it("does not treat a similar but non-passcode school.local email as retired", async () => {
    const result = await runJwt({ sub: "1", email: "teacher@school.local" });
    expect(result).toEqual({ sub: "1", email: "teacher@school.local" });
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

  it("returns user for valid program_admin persona", async () => {
    const result = await devAuthorize({ persona: "program_admin" });
    expect(result).toEqual({
      id: "dev-program_admin",
      email: DEV_LOGIN_PERSONAS.program_admin.email,
      name: "Dev Program Admin",
    });
  });

  it("returns user for valid former_mentor persona", async () => {
    const result = await devAuthorize({ persona: "former_mentor" });
    expect(result).toEqual({
      id: "dev-former_mentor",
      email: DEV_LOGIN_PERSONAS.former_mentor.email,
      name: "Dev Former Mentor",
    });
  });

  it("returns user for valid holistic_admin persona", async () => {
    const result = await devAuthorize({ persona: "holistic_admin" });
    expect(result).toEqual({
      id: "dev-holistic_admin",
      email: DEV_LOGIN_PERSONAS.holistic_admin.email,
      name: "Dev Holistic Admin",
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
