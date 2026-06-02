import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";

export const MOCK_DB_SERVICE_PORT = 4567;
export const MOCK_DB_SERVICE_URL = `http://localhost:${MOCK_DB_SERVICE_PORT}`;
const EXPECTED_TOKEN = "e2e-test-token";

interface MockMapping {
  id: number;
  mentor_id: number;
  mentee_id: number;
  academic_year: string;
  created_by: string;
  inserted_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

interface MockDbServiceState {
  mappings: MockMapping[];
}

let server: Server | null = null;
let state: MockDbServiceState = { mappings: [] };

function resetState(nextState: Partial<MockDbServiceState> = {}) {
  state = {
    mappings: [...(nextState.mappings ?? [])],
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function hasValidToken(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${EXPECTED_TOKEN}`;
}

function nextMappingId(): number {
  return Math.max(6700, ...state.mappings.map((mapping) => mapping.id)) + 1;
}

function activeMappingsFor(url: URL): MockMapping[] {
  const mentorIds = new Set(
    (url.searchParams.get("mentor_ids") ?? "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id))
  );
  const academicYear = url.searchParams.get("academic_year");

  return state.mappings.filter((mapping) => {
    if (mapping.deleted_at) return false;
    if (academicYear && mapping.academic_year !== academicYear) return false;
    return mentorIds.size === 0 || mentorIds.has(mapping.mentor_id);
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", MOCK_DB_SERVICE_URL);

  if (request.method === "POST" && url.pathname === "/__test/set-state") {
    const body = (await readBody(request)) as Partial<MockDbServiceState>;
    resetState(body);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/__test/stop") {
    sendJson(response, 200, { ok: true });
    setTimeout(() => {
      void stopMockDbServiceServer();
    }, 0);
    return;
  }

  if (!url.pathname.startsWith("/api/academic-mentorship-mapping")) {
    sendJson(response, 404, { error: `Mock db-service has no route for ${request.method} ${url.pathname}` });
    return;
  }

  if (!hasValidToken(request)) {
    sendJson(response, 401, { error: "Invalid db-service token" });
    return;
  }

  const mappingIdMatch = url.pathname.match(/^\/api\/academic-mentorship-mapping\/(\d+)$/);

  if (request.method === "GET" && url.pathname === "/api/academic-mentorship-mapping") {
    sendJson(response, 200, { mappings: activeMappingsFor(url) });
    return;
  }

  if (request.method === "GET" && mappingIdMatch) {
    const id = Number(mappingIdMatch[1]);
    const mapping = state.mappings.find((item) => item.id === id);
    if (!mapping) {
      sendJson(response, 404, { error: "Mapping not found" });
      return;
    }
    sendJson(response, 200, { mapping });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/academic-mentorship-mapping") {
    const body = (await readBody(request)) as Omit<MockMapping, "id" | "inserted_at">;
    const mapping: MockMapping = {
      id: nextMappingId(),
      mentor_id: Number(body.mentor_id),
      mentee_id: Number(body.mentee_id),
      academic_year: String(body.academic_year),
      created_by: String(body.created_by),
      inserted_at: new Date().toISOString(),
      deleted_at: null,
      updated_by: null,
      updated_at: null,
    };
    state.mappings.push(mapping);
    sendJson(response, 201, { mapping });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/academic-mentorship-mapping/batch") {
    const body = (await readBody(request)) as {
      mappings?: Array<Omit<MockMapping, "id" | "inserted_at">>;
    };
    const created = (body.mappings ?? []).map((input) => {
      const mapping: MockMapping = {
        id: nextMappingId(),
        mentor_id: Number(input.mentor_id),
        mentee_id: Number(input.mentee_id),
        academic_year: String(input.academic_year),
        created_by: String(input.created_by),
        inserted_at: new Date().toISOString(),
        deleted_at: null,
        updated_by: null,
        updated_at: null,
      };
      state.mappings.push(mapping);
      return mapping;
    });
    sendJson(response, 201, { created: created.length, mappings: created });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/academic-mentorship-mapping/reassign") {
    const body = (await readBody(request)) as {
      old_mapping_id?: number;
      new_mentor_id?: number;
      updated_by?: string;
    };
    const oldMapping = state.mappings.find(
      (mapping) => mapping.id === Number(body.old_mapping_id) && !mapping.deleted_at
    );
    if (!oldMapping) {
      sendJson(response, 404, { error: "Mapping not found" });
      return;
    }
    const now = new Date().toISOString();
    oldMapping.deleted_at = now;
    oldMapping.updated_at = now;
    oldMapping.updated_by = body.updated_by ?? null;

    const mapping: MockMapping = {
      id: nextMappingId(),
      mentor_id: Number(body.new_mentor_id),
      mentee_id: oldMapping.mentee_id,
      academic_year: oldMapping.academic_year,
      created_by: oldMapping.created_by,
      inserted_at: now,
      deleted_at: null,
      updated_by: null,
      updated_at: null,
    };
    state.mappings.push(mapping);
    sendJson(response, 200, { mapping });
    return;
  }

  if (request.method === "DELETE" && mappingIdMatch) {
    const id = Number(mappingIdMatch[1]);
    const mapping = state.mappings.find((item) => item.id === id && !item.deleted_at);
    if (!mapping) {
      sendJson(response, 404, { error: "Mapping not found" });
      return;
    }
    const body = (await readBody(request)) as { updated_by?: string };
    const now = new Date().toISOString();
    mapping.deleted_at = now;
    mapping.updated_at = now;
    mapping.updated_by = body.updated_by ?? null;
    sendJson(response, 200, { mapping });
    return;
  }

  sendJson(response, 404, { error: `Mock db-service has no route for ${request.method} ${url.pathname}` });
}

export async function startMockDbServiceServer(): Promise<void> {
  if (server?.listening) return;
  resetState();

  server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Mock db-service failed" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(MOCK_DB_SERVICE_PORT, resolve);
  });
}

export async function stopMockDbServiceServer(): Promise<void> {
  if (!server?.listening) {
    try {
      await fetch(`${MOCK_DB_SERVICE_URL}/__test/stop`, { method: "POST" });
    } catch {
      // The server may already be stopped in this process.
    }
    server = null;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      server = null;
      resolve();
    });
  });
}

export async function setMockDbServiceState(nextState: MockDbServiceState): Promise<void> {
  const response = await fetch(`${MOCK_DB_SERVICE_URL}/__test/set-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextState),
  });
  if (!response.ok) {
    throw new Error(`Failed to set mock db-service state: ${response.status}`);
  }
}
