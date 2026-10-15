import { CORS_HEADERS, authorizationServerMetadata, publicOrigin } from "@/lib/mcp/oauth";

// Served at /.well-known/oauth-authorization-server (rewrite in next.config).
export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(publicOrigin(request)), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
