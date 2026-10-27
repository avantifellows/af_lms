// Concern Resolution history writes (server-only: runs on a `withTransaction` client). These are
// LMS-owned, append-only history tables like the intervention-flag history, so they are written
// directly, not through the DB Service. Each write locks the concern row `FOR UPDATE`, checks its
// kind and status, changes the status (resolve / reopen) and appends one event, so the status
// change and its event commit together. db-service's auto-reopen locks the same row.
import type { PoolClient } from "pg";

export class VisitConcernEventError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface ConcernEventParams {
  concernId: number;
  actorEmail: string;
  body: string;
}

type ConcernStatus = "open" | "resolved";

interface LockedConcern {
  kind: "concern" | "highlight";
  status: ConcernStatus | null;
}

async function lockConcern(client: PoolClient, concernId: number): Promise<LockedConcern> {
  const { rows } = await client.query<LockedConcern>(
    `SELECT kind, status FROM lms_visit_concerns WHERE id = $1 FOR UPDATE`,
    [concernId]
  );
  const concern = rows[0];
  if (!concern) throw new VisitConcernEventError(404, "Concern not found");
  if (concern.kind !== "concern") {
    throw new VisitConcernEventError(409, "Highlights can't be resolved, commented on or reopened");
  }
  return concern;
}

async function requireStatus(client: PoolClient, concernId: number, expected: ConcernStatus, message: string) {
  const concern = await lockConcern(client, concernId);
  if (concern.status !== expected) throw new VisitConcernEventError(409, message);
}

// Timestamps are `timestamp without time zone` holding UTC.
async function setStatus(client: PoolClient, concernId: number, status: ConcernStatus) {
  await client.query(
    `UPDATE lms_visit_concerns
     SET status = $2, updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $1`,
    [concernId, status]
  );
}

async function appendEvent(
  client: PoolClient,
  kind: "resolved" | "comment" | "reopened",
  { concernId, actorEmail, body }: ConcernEventParams
) {
  await client.query(
    `INSERT INTO lms_visit_concern_events (concern_id, kind, body, author_email, inserted_at)
     VALUES ($1, $2, $3, $4, (NOW() AT TIME ZONE 'UTC'))`,
    [concernId, kind, body, actorEmail.toLowerCase()]
  );
}

// Open → resolved, with the explanation as a `resolved` event.
export async function resolveConcern(client: PoolClient, params: ConcernEventParams): Promise<void> {
  await requireStatus(client, params.concernId, "open", "This concern is already resolved");
  await setStatus(client, params.concernId, "resolved");
  await appendEvent(client, "resolved", params);
}

// A `comment` event on a resolved concern; the status doesn't change.
export async function commentOnConcern(client: PoolClient, params: ConcernEventParams): Promise<void> {
  await requireStatus(client, params.concernId, "resolved", "Only resolved concerns take comments; this one is open");
  await appendEvent(client, "comment", params);
}

// Resolved → open, with the reason as a `reopened` event.
export async function reopenConcern(client: PoolClient, params: ConcernEventParams): Promise<void> {
  await requireStatus(client, params.concernId, "resolved", "This concern is already open");
  await setStatus(client, params.concernId, "open");
  await appendEvent(client, "reopened", params);
}
