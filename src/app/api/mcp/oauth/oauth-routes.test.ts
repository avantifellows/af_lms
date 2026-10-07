import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getResolvedPermission: vi.fn() }));

import { getServerSession } from "next-auth";
import { getResolvedPermission } from "@/lib/permissions";
import { POST as register } from "./register/route";
import { GET as authorize, POST as approve } from "./authorize/route";
import { POST as token } from "./token/route";
import { bearerEmail } from "@/lib/mcp/oauth";

const ORIGIN = "https://lms.example.org";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const EMAIL = "pm@avantifellows.org";
const VERIFIER = "v".repeat(50);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const mockSession = vi.mocked(getServerSession);
const mockPermission = vi.mocked(getResolvedPermission);
const signedIn = (email = EMAIL) => ({ user: { email }, expires: "2099-01-01" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  vi.stubEnv("NEXTAUTH_URL", ORIGIN);
  mockPermission.mockResolvedValue({ email: EMAIL } as never);
});
afterEach(() => vi.unstubAllEnvs());

async function registerClient(redirect_uris: string[] = [REDIRECT]): Promise<string> {
  const res = await register(
    new Request(`${ORIGIN}/api/mcp/oauth/register`, {
      method: "POST",
      body: JSON.stringify({ client_name: "Claude", redirect_uris }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()).client_id;
}

function authorizeUrl(clientId: string, overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st",
    ...overrides,
  });
  return `${ORIGIN}/api/mcp/oauth/authorize?${params}`;
}

async function consentToken(clientId: string): Promise<string> {
  mockSession.mockResolvedValue(signedIn());
  const html = await (await authorize(new Request(authorizeUrl(clientId)))).text();
  const raw = /name="consent" value="([^"]+)"/.exec(html)![1];
  return raw.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
}

async function submit(consent: string, decision = "approve") {
  const body = new URLSearchParams({ consent, decision });
  return approve(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, { method: "POST", body }));
}

async function exchange(params: Record<string, string>) {
  return token(
    new Request(`${ORIGIN}/api/mcp/oauth/token`, { method: "POST", body: new URLSearchParams(params) }),
  );
}

async function codeFor(clientId: string): Promise<string> {
  const res = await submit(await consentToken(clientId));
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location")!).searchParams.get("code")!;
}

describe("register", () => {
  it("refuses non-https redirect URIs off loopback", async () => {
    const res = await register(
      new Request(`${ORIGIN}/r`, { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("authorize", () => {
  it("shows an error page (no redirect) for an unregistered redirect_uri", async () => {
    const clientId = await registerClient();
    const res = await authorize(new Request(authorizeUrl(clientId, { redirect_uri: "https://evil.example/cb" })));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("requires PKCE S256", async () => {
    const clientId = await registerClient();
    const res = await authorize(new Request(authorizeUrl(clientId, { code_challenge_method: "plain" })));
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });

  it("asks a signed-out user to sign in with Google and come back", async () => {
    mockSession.mockResolvedValue(null);
    const clientId = await registerClient();
    const html = await (await authorize(new Request(authorizeUrl(clientId)))).text();
    expect(html).toContain('action="/api/auth/signin/google"');
    expect(html).toContain("/api/mcp/oauth/authorize?");
  });


  it("refuses an account with no LMS permission", async () => {
    mockSession.mockResolvedValue(signedIn("outsider@gmail.com"));
    mockPermission.mockResolvedValue(null);
    const clientId = await registerClient();
    const res = await authorize(new Request(authorizeUrl(clientId)));
    expect(res.status).toBe(403);
  });

  it("shows a consent page that can't be framed", async () => {
    mockSession.mockResolvedValue(signedIn());
    const clientId = await registerClient();
    const res = await authorize(new Request(authorizeUrl(clientId)));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(await res.text()).toContain(EMAIL);
  });

  it("approval by a different (or no) session is refused", async () => {
    const consent = await consentToken(await registerClient());
    mockSession.mockResolvedValue(null);
    expect((await submit(consent)).status).toBe(403);
    mockSession.mockResolvedValue(signedIn("someone-else@avantifellows.org"));
    expect((await submit(consent)).status).toBe(403);
  });

  it("deny redirects with access_denied and the state", async () => {
    const res = await submit(await consentToken(await registerClient()), "deny");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("st");
  });
});

describe("token", () => {
  it("exchanges a code + verifier for tokens that authenticate the MCP endpoint", async () => {
    const clientId = await registerClient();
    const code = await codeFor(clientId);
    const res = await exchange({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const mcp = new Request(`${ORIGIN}/api/mcp`, { headers: { authorization: `Bearer ${body.access_token}` } });
    expect(bearerEmail(mcp, ORIGIN)).toBe(EMAIL);
  });

  it.each([
    ["a wrong verifier", { code_verifier: "w".repeat(50) }],
    ["a different redirect_uri", { redirect_uri: "https://claude.ai/other" }],
  ])("refuses %s", async (_, override) => {
    const clientId = await registerClient();
    const code = await codeFor(clientId);
    const res = await exchange({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      ...override,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("refuses a code presented by another client", async () => {
    const code = await codeFor(await registerClient());
    const other = await registerClient(["https://other.example/cb"]);
    const res = await exchange({
      grant_type: "authorization_code",
      code,
      client_id: other,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("refreshes only while the account still has LMS access", async () => {
    const clientId = await registerClient();
    const code = await codeFor(clientId);
    const { refresh_token } = await (
      await exchange({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER })
    ).json();

    expect((await exchange({ grant_type: "refresh_token", refresh_token, client_id: clientId })).status).toBe(200);

    mockPermission.mockResolvedValue(null);
    const revoked = await exchange({ grant_type: "refresh_token", refresh_token, client_id: clientId });
    expect((await revoked.json()).error).toBe("invalid_grant");
  });

  it("refuses a client registered on another environment (shared NEXTAUTH_SECRET)", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://staging.example.org");
    const stagingClient = await registerClient();
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    mockSession.mockResolvedValue(signedIn());
    expect((await authorize(new Request(authorizeUrl(stagingClient)))).status).toBe(400);
    const res = await exchange({ grant_type: "refresh_token", refresh_token: "x", client_id: stagingClient });
    expect(res.status).toBe(401);
  });

  it("refuses a code issued on another environment", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://staging.example.org");
    const clientId = await registerClient();
    const code = await codeFor(clientId);
    // Same secret, same client blob, but presented to production.
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const forged = await exchange({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect(forged.status).toBe(401);
  });

  it("rejects an unknown client", async () => {
    const res = await exchange({ grant_type: "refresh_token", refresh_token: "x", client_id: "forged" });
    expect(res.status).toBe(401);
  });
});
