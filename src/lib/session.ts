import { AsyncLocalStorage } from "node:async_hooks";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";

// The session a route handler acts as. In a browser request that is the
// NextAuth cookie session, exactly as `getServerSession(authOptions)`. When the
// MCP endpoint invokes a handler in-process, it is the MCP caller instead: the
// outer request carries an MCP credential, not an LMS cookie, so the handler
// must not read identity from it.
//
// Only routes reachable through MCP (see `src/lib/mcp/views.ts`) and the gates
// they use need to call this; everywhere else `getServerSession` is equivalent.
const mcpSessionStorage = new AsyncLocalStorage<Session>();

export async function getSession(): Promise<Session | null> {
  return mcpSessionStorage.getStore() ?? getServerSession(authOptions);
}

// Run `fn` with route handlers seeing `email` as the signed-in Google user.
export function runAsMcpCaller<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const session: Session = {
    user: { email },
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
  return mcpSessionStorage.run(session, fn);
}
