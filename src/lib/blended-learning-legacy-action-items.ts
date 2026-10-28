import { canAccessBlendedStudent, canBlendedLearning, type BlendedLearningAccess } from "./blended-learning-access";
import { oneOf } from "./blended-learning-format";
import { storedLegacyActionItems } from "./blended-learning-legacy-conversations";
import type { LegacyActionItemView } from "./blended-learning-mentee-detail";
import { query } from "./db";

// Ticking a Profile Doc action item done (or open again) on the Profile Doc
// card (server-only). Only the Student's own Mentor (the `log` action, in
// scope); anyone else gets 403. The item is addressed by its index in
// legacy_action_items and must still have the text and owner the Mentor saw,
// else a re-import changed the list and it is a 409. One UPDATE: the element
// gets done_at / done_by_email (kept as they were when ticked again).

export type LegacyActionItemTick = { index: number; text: string; owner: string; done: boolean };

export type TickLegacyActionItemResult =
  | { ok: true; item: LegacyActionItemView }
  | { ok: false; status: 403 | 409 | 422; error: string };

const OWNERS = ["student", "mentor", "parent"] as const;
const MAX_INDEX = 9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The request body, or null when it is not { index, text, owner, done }.
export function parseLegacyActionItemTick(body: unknown): LegacyActionItemTick | null {
  if (!isRecord(body)) return null;
  const { index, text, owner, done } = body;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > MAX_INDEX) return null;
  if (typeof text !== "string" || !oneOf(OWNERS, owner) || typeof done !== "boolean") return null;
  return { index: index as number, text, owner, done };
}

const FORBIDDEN = { ok: false, status: 403, error: "Forbidden" } as const;

export async function tickLegacyActionItem(
  access: BlendedLearningAccess,
  studentId: number,
  body: unknown
): Promise<TickLegacyActionItemResult> {
  if (!canBlendedLearning(access, "log")) return FORBIDDEN;
  const tick = parseLegacyActionItemTick(body);
  if (!tick) return { ok: false, status: 422, error: "Send the item's index, text, owner and done." };
  if (!(await canAccessBlendedStudent(access, studentId))) return FORBIDDEN;

  const rows = await query<{ item: unknown }>(
    `UPDATE blended_learning_student_links links
     SET legacy_action_items = jsonb_set(
           links.legacy_action_items,
           ARRAY[$2::int::text],
           (links.legacy_action_items -> $2::int) || jsonb_build_object(
             'done_at', CASE WHEN $5::boolean
               THEN COALESCE(NULLIF(links.legacy_action_items -> $2::int -> 'done_at', 'null'::jsonb), to_jsonb(now()))
               ELSE 'null'::jsonb END,
             'done_by_email', CASE WHEN $5::boolean
               THEN COALESCE(NULLIF(links.legacy_action_items -> $2::int -> 'done_by_email', 'null'::jsonb), to_jsonb($6::text))
               ELSE 'null'::jsonb END)),
         updated_at = now()
     WHERE links.student_id = $1
       AND jsonb_typeof(links.legacy_action_items) = 'array'
       AND links.legacy_action_items -> $2::int ->> 'text' = $3
       AND links.legacy_action_items -> $2::int ->> 'owner' = $4
     RETURNING links.legacy_action_items -> $2::int AS item`,
    [studentId, tick.index, tick.text, tick.owner, tick.done, access.actorEmail]
  );
  const item = rows[0] ? storedLegacyActionItems([rows[0].item])[0] : undefined;
  if (!item) return { ok: false, status: 409, error: "These Profile Doc items have changed. Reload the page." };
  return {
    ok: true,
    item: { index: tick.index, text: item.text, owner: item.owner, doneAt: item.done_at, doneByEmail: item.done_by_email },
  };
}
