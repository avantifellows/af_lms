import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query } from "@/lib/db";
import { getAccessibleSchoolCodes, getResolvedPermission } from "@/lib/permissions";
import { runAsMcpCaller } from "@/lib/session";
import { LMS_VIEWS, invokeView, matchView } from "@/lib/mcp/views";

// The MCP caller, resolved by the route before the server is built. Spike:
// this comes from the NextAuth session cookie. Once the OAuth server lands it
// comes from the bearer token instead; tools only ever see this shape.
export interface McpCaller {
  email: string;
}

// Responses larger than this are cut, so one view can't blow the model's
// context (or Amplify's 5.72 MB response cap).
const MAX_VIEW_CHARS = 200_000;
const MAX_SCHOOLS = 100;

const INSTRUCTIONS = `Avanti Fellows LMS, read-only, as the signed-in user: you see exactly the schools and data the LMS shows them, nothing more. A 403 means the user lacks access; say so rather than retrying around it.

How to answer:
- Start from list_my_schools to find a school's code/UDISE, then list_views, then get_view.
- Curriculum: call /api/curriculum/options for a school first; it gives the program, exam tracks, grades and subjects the progress and chapters views require. Progress is keyed by chapter id; join it with /api/curriculum/chapters for chapter names.
- Quiz analytics: /grades first, then /batch-overview for the tests (each with a session_id), then /test-deep-dive or /cumulative-als.
- Prefer aggregates (completion %, averages, counts) over per-student rows. Say which school, grade and program a figure covers.

Student data: names and scores are visible to this user in the LMS, but don't copy per-student rows into documents, slides or messages unless the user explicitly asks for individual students.`;

type ToolResult ={ content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError } : {}),
});

const NOT_SIGNED_IN = text("Not signed in to the LMS.", true);

// One structured line per tool call. Never log arguments' values beyond the
// path: they can carry student identifiers.
function logCall(caller: McpCaller | null, tool: string, startedAt: number, extra: object) {
  console.log(
    JSON.stringify({
      event: "lms_mcp_call",
      email: caller?.email ?? null,
      tool,
      ms: Date.now() - startedAt,
      ...extra,
    }),
  );
}

// Built fresh per request: the transport is stateless, so nothing may live on
// the server between calls (Amplify gives no instance affinity anyway).
export function buildLmsMcpServer(caller: McpCaller | null, baseUrl: string): McpServer {
  const server = new McpServer(
    { name: "avanti-lms", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Returns the signed-in LMS user and the access level the LMS grants them.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!caller) return NOT_SIGNED_IN;
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
      return text(JSON.stringify(summary, null, 2));
    },
  );

  server.registerTool(
    "list_my_schools",
    {
      title: "List my schools",
      description:
        `Schools the signed-in user can see in the LMS (code, UDISE, name, region). Most views need a school's code or UDISE. Use \`search\` to filter by name, code or region; at most ${MAX_SCHOOLS} are returned.`,
      inputSchema: { search: z.string().optional().describe("Name, code, UDISE or region fragment") },
      annotations: { readOnlyHint: true },
    },
    async ({ search }) => {
      if (!caller) return NOT_SIGNED_IN;
      const startedAt = Date.now();
      const codes = await getAccessibleSchoolCodes(caller.email);
      const like = search ? `%${search.trim()}%` : null;
      const rows = await query<{ code: string; udise_code: string | null; name: string; region: string | null }>(
        `SELECT code, udise_code, name, region FROM school
         WHERE ($1::text[] IS NULL OR code = ANY($1))
           AND ($2::text IS NULL OR name ILIKE $2 OR code ILIKE $2 OR udise_code ILIKE $2 OR region ILIKE $2)
         ORDER BY name
         LIMIT $3`,
        [codes === "all" ? null : codes, like, MAX_SCHOOLS + 1],
      );
      logCall(caller, "list_my_schools", startedAt, { status: 200, rows: rows.length });
      const truncated = rows.length > MAX_SCHOOLS;
      return text(
        JSON.stringify(
          { schools: rows.slice(0, MAX_SCHOOLS), ...(truncated ? { note: "More match; narrow with search." } : {}) },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    "list_views",
    {
      title: "List LMS views",
      description:
        "The LMS read endpoints you can call with get_view, each with what it returns and its parameters. Call this before get_view.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      text(
        JSON.stringify(
          LMS_VIEWS.map(({ path, description, query: params }) => ({ path, description, query: params })),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    "get_view",
    {
      title: "Get LMS view",
      description:
        "Call one LMS read endpoint from list_views as the signed-in user and return its JSON. Fill path parameters in `path` (e.g. /api/quiz-analytics/<udise>/grades) and put query parameters in `query`. The user's LMS permissions apply exactly as in the LMS.",
      inputSchema: {
        path: z.string().describe("Endpoint path from list_views, with [segments] filled in"),
        query: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional()
          .describe("Query parameters"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, query: params }) => {
      if (!caller) return NOT_SIGNED_IN;
      const startedAt = Date.now();
      const match = matchView(path);
      if (!match) {
        logCall(caller, "get_view", startedAt, { path, status: 404 });
        return text(`Unknown view: ${path}. Call list_views for the available paths.`, true);
      }
      const response = await runAsMcpCaller(caller.email, () =>
        invokeView(match, path, params ?? {}, baseUrl),
      );
      logCall(caller, "get_view", startedAt, { path: match.view.path, status: response.status });
      let body = await response.text();
      if (body.length > MAX_VIEW_CHARS) {
        body = `${body.slice(0, MAX_VIEW_CHARS)}\n…[truncated: ${body.length} chars; narrow the query]`;
      }
      return response.ok ? text(body) : text(`HTTP ${response.status}: ${body}`, true);
    },
  );

  return server;
}
