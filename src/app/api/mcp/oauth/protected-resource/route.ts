import { CORS_HEADERS, protectedResourceMetadata, publicOrigin } from "@/lib/mcp/oauth";

// Served at /.well-known/oauth-protected-resource[/api/mcp] (rewrite in next.config).
export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(publicOrigin(request)), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
