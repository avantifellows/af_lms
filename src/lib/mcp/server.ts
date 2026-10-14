import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query } from "@/lib/db";
import { isPmuRole } from "@/lib/constants";
import {
  getAccessibleSchoolCodes,
  getFeatureAccess,
  getResolvedPermission,
  type UserPermission,
} from "@/lib/permissions";
import { runAsMcpCaller } from "@/lib/session";
import { LMS_VIEWS, NOTES_PARAM, invokeView, matchView, programGuard, type LmsView } from "@/lib/mcp/views";

// The MCP caller, resolved by the route (OAuth bearer token) before the server
// is built; tools only ever see this shape.
export interface McpCaller {
  email: string;
}

// Responses larger than this are refused rather than cut (a cut leaves broken
// JSON), so one view can't blow the model's context or Amplify's 5.72 MB cap.
const MAX_VIEW_CHARS = 200_000;
const MAX_SCHOOLS = 100;

const INSTRUCTIONS = `Avanti Fellows LMS, read-only, as the signed-in user: you see exactly the schools and data the LMS shows them, nothing more. A 403 means the user lacks access; say so rather than retrying around it.

How to answer:
- Start from list_my_schools to find a school's code/UDISE, then list_views, then get_view.
- Curriculum: call /api/curriculum/options for a school first; it gives the program, exam tracks, grades and subjects the progress and chapters views require. Progress is keyed by chapter id; join it with /api/curriculum/chapters for chapter names.
- Quiz analytics: /grades first (it lists the programs you may query; the other quiz views require one of them as the program parameter), then /batch-overview for the tests (each with a session_id), then /test-deep-dive or /cumulative-als.
- Prefer aggregates (completion %, averages, counts) over per-student rows. Say which school, grade and program a figure covers.

Student data: names and scores are visible to this user in the LMS, but don't copy per-student rows into documents, slides or messages unless the user explicitly asks for individual students.

Mentorship notes: Holistic Mentorship progress omits the mentors' note text by default. Pass include_notes=true only when the user explicitly asks to read what was written in notes, never to count or summarise sessions. Treat note content as confidential: quote only what the user asked for, and never copy it into documents or messages unless asked.`;

type ToolResult ={ content: { type: "text"; text: string }[]; isError?: boolean };

const viewAllowed = (view: LmsView, permission: UserPermission | null) =>
  !view.feature || getFeatureAccess(permission, view.feature).canView;

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError } : {}),
});

// One structured line per tool call. Never log arguments' values beyond the
// path: they can carry student identifiers.
function logCall(caller: McpCaller, tool: string, startedAt: number, extra: object) {
  console.log(
    JSON.stringify({
      event: "lms_mcp_call",
      email: caller.email,
      tool,
      ms: Date.now() - startedAt,
      ...extra,
    }),
  );
}

// Built fresh per request: the transport is stateless, so nothing may live on
// the server between calls (Amplify gives no instance affinity anyway).
export function buildLmsMcpServer(caller: McpCaller, baseUrl: string): McpServer {
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
      const startedAt = Date.now();
      const permission = await getResolvedPermission(caller.email);
      const codes = await getAccessibleSchoolCodes(caller.email, permission);
      const like = search ? `%${search.trim()}%` : null;
      // PMU roles are NVS-only: the LMS hides and refuses non-JNV schools for
      // them (dashboard, authorizeSchoolAccess), so don't offer them here.
      const jnvOnly = isPmuRole(permission?.role);
      const rows = await query<{ code: string; udise_code: string | null; name: string; region: string | null }>(
        `SELECT code, udise_code, name, region FROM school
         WHERE ($1::text[] IS NULL OR code = ANY($1))
           AND ($2::text IS NULL OR name ILIKE $2 OR code ILIKE $2 OR udise_code ILIKE $2 OR region ILIKE $2)
           AND (NOT $4::boolean OR af_school_category = 'JNV')
         ORDER BY name
         LIMIT $3`,
        [codes === "all" ? null : codes, like, MAX_SCHOOLS + 1, jnvOnly],
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
        "The LMS read endpoints you can call with get_view, each with what it returns and its parameters. Only views the user's LMS role can use are listed. Call this before get_view.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const permission = await getResolvedPermission(caller.email);
      return text(
        JSON.stringify(
          LMS_VIEWS.filter((view) => viewAllowed(view, permission)).map(({ path, description, query: params }) => ({
            path,
            description,
            query: params,
          })),
          null,
          2,
        ),
      );
    },
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
      const startedAt = Date.now();
      const match = matchView(path);
      if (!match) {
        logCall(caller, "get_view", startedAt, { path, status: 404 });
        return text(`Unknown view: ${path}. Call list_views for the available paths.`, true);
      }
      const undeclared = Object.keys(params ?? {}).filter((k) => !(k in match.view.query));
      if (undeclared.length) {
        logCall(caller, "get_view", startedAt, { path: match.view.path, status: 400 });
        return text(
          `Unsupported parameter(s) for ${match.view.path}: ${undeclared.join(", ")}. Allowed: ${Object.keys(match.view.query).join(", ") || "none"}.`,
          true,
        );
      }
      const permission = await getResolvedPermission(caller.email);
      if (!viewAllowed(match.view, permission)) {
        logCall(caller, "get_view", startedAt, { path: match.view.path, status: 403 });
        return text(
          `The user's LMS role (${permission?.role ?? "none"}) has no access to ${match.view.path}; it isn't in list_views for them. Don't retry it.`,
          true,
        );
      }
      const { [NOTES_PARAM]: notesFlag, ...forwarded } = params ?? {};
      const includeNotes = String(notesFlag) === "true";
      const result = await runAsMcpCaller(caller.email, async () => {
        const refusal = await programGuard(match, forwarded, baseUrl);
        return refusal ?? invokeView(match, path, forwarded, baseUrl);
      });
      if (typeof result === "string") {
        logCall(caller, "get_view", startedAt, { path: match.view.path, status: 403 });
        return text(result, true);
      }
      const response = result;
      logCall(caller, "get_view", startedAt, {
        path: match.view.path,
        status: response.status,
        ...(includeNotes ? { notes: true } : {}),
      });
      let body = await response.text();
      if (response.ok && match.view.redact) {
        try {
          body = JSON.stringify(match.view.redact(JSON.parse(body), { includeNotes }));
        } catch {
          // A view with a redaction rule must not leak an unparsed body.
          return text("The LMS returned an unexpected response for this view.", true);
        }
      }
      if (body.length > MAX_VIEW_CHARS) {
        return text(
          `Response too large (${body.length} characters, limit ${MAX_VIEW_CHARS}). Narrow it with this view's filters (e.g. a grade, program, school or phase) and try again.`,
          true,
        );
      }
      return response.ok ? text(body) : text(`HTTP ${response.status}: ${body}`, true);
    },
  );

  return server;
}
