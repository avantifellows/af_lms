import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bearerEmail,
  issueTokens,
  isAllowedRedirectUri,
  pkceS256Matches,
  redirectUriRegistered,
  sign,
  verify,
} from "./oauth";

const ORIGIN = "https://lms.example.org";

beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "test-secret"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("sign / verify", () => {
  it("round-trips a payload of the same type", () => {
    const token = sign("code", { email: "a@x.org" }, 60);
    expect(verify<{ email: string }>("code", token)?.email).toBe("a@x.org");
  });

  it("rejects a token of another type", () => {
    expect(verify("access", sign("refresh", { email: "a@x.org" }, 60))).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [, mac] = sign("access", { email: "a@x.org" }, 60).split(".");
    const forged = Buffer.from(JSON.stringify({ email: "admin@x.org", typ: "access" })).toString("base64url");
    expect(verify("access", `${forged}.${mac}`)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = sign("access", { email: "a@x.org" }, 60);
    vi.stubEnv("NEXTAUTH_SECRET", "other-secret");
    expect(verify("access", token)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    const token = sign("code", { email: "a@x.org" }, 60);
    vi.advanceTimersByTime(61_000);
    expect(verify("code", token)).toBeNull();
  });

  it("rejects garbage", () => {
    for (const t of ["", "abc", "a.b.c", "a.b", null, undefined]) expect(verify("access", t)).toBeNull();
  });
});

describe("PKCE S256", () => {
  const verifier = "a".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("accepts the matching verifier", () => expect(pkceS256Matches(verifier, challenge)).toBe(true));
  it("rejects another verifier", () => expect(pkceS256Matches("b".repeat(43), challenge)).toBe(false));
  it("rejects a too-short verifier", () => expect(pkceS256Matches("abc", challenge)).toBe(false));
});

describe("redirect URIs", () => {
  it.each([
    ["https://claude.ai/api/mcp/auth_callback", true],
    ["http://localhost:33418/callback", true],
    ["http://127.0.0.1/cb", true],
    ["http://evil.example/cb", false],
    ["https://claude.ai/cb#frag", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("%s allowed=%s", (uri, allowed) => expect(isAllowedRedirectUri(uri)).toBe(allowed));

  const client = { iss: ORIGIN, redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost:33418/callback"] };

  it("matches registered URIs exactly", () => {
    expect(redirectUriRegistered(client, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriRegistered(client, "https://claude.ai/api/mcp/auth_callback/x")).toBe(false);
  });

  it("lets a loopback redirect change port but not path or host", () => {
    expect(redirectUriRegistered(client, "http://localhost:51234/callback")).toBe(true);
    expect(redirectUriRegistered(client, "http://localhost:51234/other")).toBe(false);
    expect(redirectUriRegistered(client, "http://127.0.0.1:51234/callback")).toBe(false);
  });
});

describe("bearerEmail", () => {
  const withBearer = (token: string) =>
    new Request(`${ORIGIN}/api/mcp`, { headers: { authorization: `Bearer ${token}` } });

  it("returns the email of a valid access token", () => {
    const { access_token } = issueTokens("pm@x.org", "client-1", ORIGIN);
    expect(bearerEmail(withBearer(access_token), ORIGIN)).toBe("pm@x.org");
  });

  it("rejects a refresh token used as an access token", () => {
    const { refresh_token } = issueTokens("pm@x.org", "client-1", ORIGIN);
    expect(bearerEmail(withBearer(refresh_token), ORIGIN)).toBeNull();
  });

  it("rejects a token minted for another environment", () => {
    const { access_token } = issueTokens("pm@x.org", "client-1", "https://staging.example.org");
    expect(bearerEmail(withBearer(access_token), ORIGIN)).toBeNull();
  });

  it("is null without an Authorization header", () => {
    expect(bearerEmail(new Request(`${ORIGIN}/api/mcp`), ORIGIN)).toBeNull();
  });
});
