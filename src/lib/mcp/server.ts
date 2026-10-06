import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getResolvedPermission } from "@/lib/permissions";

// The MCP caller, resolved by the route before the server is built. Spike:
// this comes from the NextAuth session cookie. Once the OAuth server lands it
// comes from the bearer token instead; tools only ever see this shape.
export interface McpCaller {
  email: string;
}

// Built fresh per request: the transport is stateless, so nothing may live on
// the server between calls (Amplify gives no instance affinity anyway).
export function buildLmsMcpServer(caller: McpCaller | null): McpServer {
  const server = new McpServer({ name: "avanti-lms", version: "0.1.0" });

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Returns the signed-in LMS user and the access level the LMS grants them.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!caller) {
        return { content: [{ type: "text", text: "Not signed in to the LMS." }] };
      }
      const permission = await getResolvedPermission(caller.email);
      const scope = permission?.scope;
      const summary = permission
        ? {
            email: caller.email,
            role: permission.role,
            level: permission.level,
            read_only: permission.read_only === true,
            schools: scope?.schools === "all" ? "all" : scope?.schools.size ?? 0,
            centres: scope?.centres === "all" ? "all" : scope?.centres.size ?? 0,
          }
        : { email: caller.email, role: null, note: "No LMS permission for this account." };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  );

  return server;
}
