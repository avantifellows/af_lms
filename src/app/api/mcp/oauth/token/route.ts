import { getResolvedPermission } from "@/lib/permissions";
import {
  CORS_HEADERS,
  clientFingerprint,
  issueTokens,
  mcpResource,
  oauthError,
  pkceS256Matches,
  publicOrigin,
  verify,
  type ClientPayload,
  type CodePayload,
  type TokenPayload,
} from "@/lib/mcp/oauth";

async function readParams(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(
      Object.entries(body).filter(([, v]) => typeof v === "string") as [string, string][],
    );
  }
  return new URLSearchParams(await request.text());
}

// Token endpoint: authorization_code (with PKCE S256) and refresh_token.
export async function POST(request: Request) {
  const origin = publicOrigin(request);
  const params = await readParams(request);
  const clientId = params.get("client_id");
  const client = verify<ClientPayload>("client", clientId);
  if (!clientId || !client || client.iss !== origin) {
    return oauthError("invalid_client", "Unknown client_id", 401);
  }
  switch (params.get("grant_type")) {
    case "authorization_code":
      return authorizationCodeGrant(params, clientId, origin);
    case "refresh_token":
      return refreshTokenGrant(params, clientId, origin);
    default:
      return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  }
}

function authorizationCodeGrant(params: URLSearchParams, clientId: string, origin: string) {
  const code = verify<CodePayload>("code", params.get("code"));
  if (!code || code.cid !== clientFingerprint(clientId) || code.iss !== origin) {
    return oauthError("invalid_grant", "Authorization code is invalid or expired");
  }
  if (params.get("redirect_uri") !== code.redirect_uri) {
    return oauthError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  const verifier = params.get("code_verifier");
  if (!verifier || !pkceS256Matches(verifier, code.code_challenge)) {
    return oauthError("invalid_grant", "PKCE verification failed");
  }
  return tokenResponse(code.email, clientId, origin);
}

async function refreshTokenGrant(params: URLSearchParams, clientId: string, origin: string) {
  const refresh = verify<TokenPayload>("refresh", params.get("refresh_token"));
  if (!refresh || refresh.cid !== clientFingerprint(clientId) || refresh.aud !== mcpResource(origin)) {
    return oauthError("invalid_grant", "Refresh token is invalid or expired");
  }
  // Refreshing is where a removed LMS user would otherwise keep a session
  // going for 30 days; stop them here as well as on every MCP request.
  if (!(await getResolvedPermission(refresh.email))) {
    return oauthError("invalid_grant", "This account no longer has LMS access");
  }
  return tokenResponse(refresh.email, clientId, origin);
}

function tokenResponse(email: string, clientId: string, origin: string) {
  return Response.json(issueTokens(email, clientId, origin), {
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", ...CORS_HEADERS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
