import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// OAuth 2.1 authorization server for the LMS MCP connector, stateless: client
// ids, authorization codes and tokens are all HMAC-signed payloads, so nothing
// is stored and no table (hence no db-service migration) is needed. The key is
// derived from NEXTAUTH_SECRET with a label of its own, so these tokens can
// never be confused with NextAuth's.
//
// Trade-offs of being stateless, accepted for v1:
// - An authorization code is reusable until it expires (5 min). PKCE still
//   binds it to the client that holds the verifier.
// - Tokens can't be revoked individually. Every MCP request re-resolves the
//   caller's LMS permission, so removing their LMS access cuts them off.

export const AUTH_CODE_TTL = 5 * 60;
export const CONSENT_TTL = 10 * 60;
export const ACCESS_TOKEN_TTL = 60 * 60;
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

type TokenType = "client" | "consent" | "code" | "access" | "refresh";

function signingKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "", "af-lms-mcp-oauth-v1", 32));
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

export function sign<T extends object>(typ: TokenType, payload: T, ttlSeconds?: number): string {
  const body = b64(
    JSON.stringify({ ...payload, typ, ...(ttlSeconds ? { exp: now() + ttlSeconds } : {}) }),
  );
  const mac = createHmac("sha256", signingKey()).update(body).digest();
  return `${body}.${b64(mac)}`;
}

export function verify<T>(typ: TokenType, token: string | null | undefined): (T & { exp?: number }) | null {
  if (!token) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac("sha256", signingKey()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: { typ?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.typ !== typ) return null;
  if (payload.exp !== undefined && payload.exp < now()) return null;
  return payload as T & { exp?: number };
}

// Short stable fingerprint of a client_id, embedded in codes and tokens so they
// only work for the client they were issued to.
export const clientFingerprint = (clientId: string) =>
  createHash("sha256").update(clientId).digest("base64url").slice(0, 22);

export function pkceS256Matches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const given = Buffer.from(challenge);
  return computed.length === given.length && timingSafeEqual(computed, given);
}

// --- URLs ---------------------------------------------------------------

// Canonical public origin. Behind Amplify the request URL may be an internal
// host, so prefer NEXTAUTH_URL, which each environment already sets.
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXTAUTH_URL;
  return new URL(configured || request.url).origin;
}

export const mcpResource = (origin: string) => `${origin}/api/mcp`;
export const protectedResourceMetadataUrl = (origin: string) =>
  `${origin}/.well-known/oauth-protected-resource`;

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["lms.read"],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: ["lms.read"],
    bearer_methods_supported: ["header"],
    resource_name: "Avanti LMS",
  };
}

// --- Clients --------------------------------------------------------------

export interface ClientPayload {
  redirect_uris: string[];
  client_name?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// https anywhere; http only on loopback (native apps such as Claude Code).
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

// Exact match, except that a loopback redirect may use any port (RFC 8252
// §7.3): native clients pick a free port per sign-in.
export function redirectUriRegistered(client: ClientPayload, uri: string): boolean {
  if (client.redirect_uris.includes(uri)) return true;
  let given: URL;
  try {
    given = new URL(uri);
  } catch {
    return false;
  }
  if (given.protocol !== "http:" || !LOOPBACK_HOSTS.has(given.hostname)) return false;
  return client.redirect_uris.some((registered) => {
    const r = new URL(registered);
    return (
      r.protocol === "http:" &&
      r.hostname === given.hostname &&
      r.pathname === given.pathname &&
      r.search === given.search
    );
  });
}

// --- Codes and tokens -----------------------------------------------------

export interface AuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
}

export interface CodePayload {
  email: string;
  cid: string;
  redirect_uri: string;
  code_challenge: string;
}

export interface TokenPayload {
  email: string;
  cid: string;
  aud: string;
}

export function issueTokens(email: string, clientId: string, origin: string) {
  const claims: TokenPayload = { email, cid: clientFingerprint(clientId), aud: mcpResource(origin) };
  return {
    access_token: sign("access", claims, ACCESS_TOKEN_TTL),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: sign("refresh", claims, REFRESH_TOKEN_TTL),
    scope: "lms.read",
  };
}

// The email a bearer token speaks for, or null if it is missing, forged,
// expired, or minted for another environment.
export function bearerEmail(request: Request, origin: string): string | null {
  const header = request.headers.get("authorization");
  const match = header && /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const claims = verify<TokenPayload>("access", match[1]);
  if (!claims || claims.aud !== mcpResource(origin)) return null;
  return claims.email;
}

export function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store", ...CORS_HEADERS } },
  );
}

// Bearer-token endpoints carry no cookies, so any origin may call them; this
// lets browser-based MCP clients (e.g. the Inspector) work.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
