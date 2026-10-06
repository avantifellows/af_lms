import { getServerSession } from "next-auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authOptions } from "@/lib/auth";
import { buildLmsMcpServer, type McpCaller } from "@/lib/mcp/server";

// Remote MCP endpoint (Streamable HTTP, stateless, JSON responses — no SSE
// stream to hold open on Amplify). Spike: identity is the NextAuth session
// cookie; passcode users are out of scope (no email). The OAuth bearer check
// must replace this before this ships: MCP clients can't hold an LMS cookie.
async function handle(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session && !session.isPasscodeUser ? session.user?.email : null;
  const caller: McpCaller | null = email ? { email } : null;

  const server = buildLmsMcpServer(caller, new URL(request.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

// Stateless: there is no server-initiated event stream or session to end.
// 405 tells clients so; answering GET with an empty stream makes them reconnect
// in a loop.
function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export { handle as POST, methodNotAllowed as GET, methodNotAllowed as DELETE };
