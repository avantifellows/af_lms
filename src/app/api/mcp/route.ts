import { getServerSession } from "next-auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authOptions } from "@/lib/auth";
import { buildLmsMcpServer, type McpCaller } from "@/lib/mcp/server";

// Remote MCP endpoint (Streamable HTTP, stateless, JSON responses — no SSE
// stream to hold open on Amplify). Spike: identity is the NextAuth session
// cookie; passcode users are out of scope (no email). The OAuth bearer check
// replaces this before any data tool is exposed.
async function handle(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session && !session.isPasscodeUser ? session.user?.email : null;
  const caller: McpCaller | null = email ? { email } : null;

  const server = buildLmsMcpServer(caller);
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

export { handle as GET, handle as POST, handle as DELETE };
