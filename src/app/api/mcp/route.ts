import { getServerSession } from "next-auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authOptions } from "@/lib/auth";
import { buildLmsMcpServer } from "@/lib/mcp/server";
import {
  CORS_HEADERS,
  bearerEmail,
  protectedResourceMetadataUrl,
  publicOrigin,
} from "@/lib/mcp/oauth";

// Remote MCP endpoint (Streamable HTTP, stateless, JSON responses — no SSE
// stream to hold open on Amplify). The caller is the email in an OAuth bearer
// token issued by /api/mcp/oauth; tools re-resolve their LMS permission on
// every call, so access changes apply immediately.
async function callerEmail(request: Request, origin: string): Promise<string | null> {
  const email = bearerEmail(request, origin);
  if (email) return email;
  // Local development only: accept the NextAuth cookie, so the server can be
  // tried without running the OAuth flow. Passcode users have no email.
  if (process.env.NODE_ENV !== "production") {
    const session = await getServerSession(authOptions);
    if (session && !session.isPasscodeUser && session.user?.email) return session.user.email;
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const origin = publicOrigin(request);
  const email = await callerEmail(request, origin);
  if (!email) {
    // Tells the client where to discover the authorization server (RFC 9728).
    return new Response(JSON.stringify({ error: "invalid_token", error_description: "Sign in required" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
        ...CORS_HEADERS,
      },
    });
  }

  const server = buildLmsMcpServer({ email }, origin);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
    return response;
  } finally {
    await server.close();
  }
}

// Stateless: there is no server-initiated event stream or session to end.
// 405 tells clients so; answering GET with an empty stream makes them reconnect
// in a loop.
function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS_HEADERS } });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export { methodNotAllowed as GET, methodNotAllowed as DELETE };
