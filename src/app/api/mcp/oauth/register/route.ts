import {
  CORS_HEADERS,
  isAllowedRedirectUri,
  oauthError,
  sign,
  type ClientPayload,
} from "@/lib/mcp/oauth";

const MAX_REDIRECT_URIS = 10;

// Dynamic client registration (RFC 7591). Public clients only (PKCE, no
// secret). The client_id is the signed registration itself, so nothing is
// stored; registering grants nothing until a signed-in LMS user approves it.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return oauthError("invalid_client_metadata", "Body must be JSON");

  const uris = body.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every((u) => typeof u === "string" && isAllowedRedirectUri(u))
  ) {
    return oauthError(
      "invalid_redirect_uri",
      "redirect_uris must be 1-10 https URLs (http only on localhost)",
    );
  }

  const name =
    typeof body.client_name === "string" ? body.client_name.trim().slice(0, 100) : undefined;
  const client: ClientPayload = { redirect_uris: uris as string[], ...(name ? { client_name: name } : {}) };

  return Response.json(
    {
      client_id: sign("client", client),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...client,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: { "Cache-Control": "no-store", ...CORS_HEADERS } },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
