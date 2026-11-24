import { query, withTransaction } from "./db";
import { canBlendedLearning, type BlendedLearningAccess } from "./blended-learning-access";
import { validateResource, type FieldErrors } from "./blended-learning-manage-input";

// Blended Learning Resources (server-only): the Mentors' reading list on the
// Resources tab, in `position` order. Everyone with the section reads them;
// a Blended Learning Admin who may `manage` adds, edits, reorders and removes
// them on the Manage page. Rows are hard-deleted.

export type Resource = { id: number; title: string; url: string };

export type ResourceResult =
  | { ok: true; resource?: Resource }
  | { ok: false; status: 403 | 404 | 422; error: string; fieldErrors?: FieldErrors };

const FORBIDDEN: ResourceResult = { ok: false, status: 403, error: "Forbidden" };
const NOT_FOUND: ResourceResult = { ok: false, status: 404, error: "Not found" };

type ResourceRow = { id: number | string; title: string; url: string };

function toResource(row: ResourceRow): Resource {
  return { id: Number(row.id), title: row.title, url: row.url };
}

function invalid(fieldErrors: FieldErrors): ResourceResult {
  return { ok: false, status: 422, error: Object.values(fieldErrors)[0], fieldErrors };
}

function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

export async function listResources(): Promise<Resource[]> {
  const rows = await query<ResourceRow>(
    `SELECT id, title, url FROM blended_learning_resources ORDER BY position, id`
  );
  return rows.map(toResource);
}

// A new Resource goes last.
export async function createResource(access: BlendedLearningAccess, raw: unknown): Promise<ResourceResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  const validated = validateResource(raw);
  if (!validated.ok) return invalid(validated.fieldErrors);
  const rows = await query<ResourceRow>(
    `INSERT INTO blended_learning_resources (title, url, position, created_by_email, updated_by_email)
     SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $3 FROM blended_learning_resources
     RETURNING id, title, url`,
    [validated.input.title, validated.input.url, access.actorEmail]
  );
  return { ok: true, resource: toResource(rows[0]) };
}

export async function updateResource(
  access: BlendedLearningAccess,
  id: number,
  raw: unknown
): Promise<ResourceResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  if (!validId(id)) return NOT_FOUND;
  const validated = validateResource(raw);
  if (!validated.ok) return invalid(validated.fieldErrors);
  const rows = await query<ResourceRow>(
    `UPDATE blended_learning_resources
     SET title = $2, url = $3, updated_by_email = $4, updated_at = now()
     WHERE id = $1
     RETURNING id, title, url`,
    [id, validated.input.title, validated.input.url, access.actorEmail]
  );
  return rows[0] ? { ok: true, resource: toResource(rows[0]) } : NOT_FOUND;
}

export async function deleteResource(access: BlendedLearningAccess, id: number): Promise<ResourceResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  if (!validId(id)) return NOT_FOUND;
  const rows = await query<{ id: number | string }>(
    `DELETE FROM blended_learning_resources WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows[0] ? { ok: true } : NOT_FOUND;
}

// The ids in their new order: `id` swapped with its neighbour above ("up") or
// below ("down"), or the order unchanged at either end.
export function movedOrder(ids: number[], id: number, direction: "up" | "down"): number[] {
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const order = [...ids];
  [order[from], order[to]] = [order[to], order[from]];
  return order;
}

// Move one Resource up or down a place. Every Resource is locked and
// renumbered 1..n in the new order, so positions stay dense whatever earlier
// deletes left behind.
export async function moveResource(
  access: BlendedLearningAccess,
  id: number,
  raw: unknown
): Promise<ResourceResult> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  if (!validId(id)) return NOT_FOUND;
  const direction = (raw as { direction?: unknown } | null)?.direction;
  if (direction !== "up" && direction !== "down") return invalid({ direction: "Move a resource up or down." });

  return withTransaction(async (client) => {
    const locked = await client.query<{ id: number | string }>(
      `SELECT id FROM blended_learning_resources ORDER BY position, id FOR UPDATE`
    );
    const ids = locked.rows.map((row) => Number(row.id));
    if (!ids.includes(id)) return NOT_FOUND;
    await client.query(
      `UPDATE blended_learning_resources resource
       SET position = ordered.position, updated_by_email = $2, updated_at = now()
       FROM unnest($1::bigint[]) WITH ORDINALITY AS ordered(id, position)
       WHERE resource.id = ordered.id AND resource.position <> ordered.position`,
      [movedOrder(ids, id, direction), access.actorEmail]
    );
    return { ok: true } satisfies ResourceResult;
  });
}
