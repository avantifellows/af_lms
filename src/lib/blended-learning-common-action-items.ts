import type { PoolClient } from "pg";

import { query, withTransaction } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { activeBlendedMappingSql, canBlendedLearning, type BlendedLearningAccess } from "./blended-learning-access";
import {
  validateCommonItem,
  validateCommonItemEdit,
  validateTarget,
  type CommonItemOwner,
  type CommonTarget,
  type FieldErrors,
} from "./blended-learning-manage-input";
import { currentGradeLateralSql } from "./blended-learning-mentees";

// Common Action Items (server-only): an Action Item a Blended Learning Admin
// pushes to every Student with an active current-year Mapping, one grade, or
// one Mentor's Students. Pushing materialises it, then and there, as one open
// Action Item per targeted Student (conversation_id NULL); Students mapped
// later get it only when it is pushed again, which adds it to targeted
// Students who don't have it yet (the partial unique index makes that
// idempotent). Mentors tick these off like any open Action Item. Editing
// updates the still-open rows; removing deletes them, keeps done ones and
// soft-removes the Common Action Item. Every call needs `manage`.

export type CommonActionItem = {
  id: number;
  text: string;
  owner: CommonItemOwner;
  target: CommonTarget;
  // The target Mentor's name, for a Mentor target.
  targetMentorName: string | null;
  openCount: number;
  doneCount: number;
  // Targeted Students who don't have it yet: what pushing again would add.
  notYetAdded: number;
  createdOn: string;
};

export type TargetMentor = { userId: number; name: string; students: number };

type Failure = { ok: false; status: 403 | 404 | 422; error: string; fieldErrors?: FieldErrors };
export type CommonItemResult<T> = ({ ok: true } & T) | Failure;

const FORBIDDEN: Failure = { ok: false, status: 403, error: "Forbidden" };
const NOT_FOUND: Failure = { ok: false, status: 404, error: "Not found" };

function invalid(fieldErrors: FieldErrors): Failure {
  return { ok: false, status: 422, error: Object.values(fieldErrors)[0], fieldErrors };
}

function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

const MENTOR_NAME_SQL = (alias: string, idSql: string) =>
  `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), ''), ${alias}.email, CONCAT('Mentor ', ${idSql}))`;

// The Student ids a target reaches: active current-year Mappings (the same
// source as the Mentee list) and the list's grade. The three SQL arguments
// are the target's kind, grade and Mentor user id: placeholders, or a Common
// Action Item's columns. `yearParam` is bound to CURRENT_ACADEMIC_YEAR.
function targetedStudentsSql(target: { kind: string; grade: string; mentor: string }, yearParam: string): string {
  return `SELECT mapping.student_id
     FROM blended_learning_mentor_mentee_mappings mapping
     JOIN student st ON st.id = mapping.student_id
     ${currentGradeLateralSql("st.user_id")}
     WHERE ${activeBlendedMappingSql("mapping", yearParam)}
       AND (
         ${target.kind} = 'all'
         OR (${target.kind} = 'grade' AND current_grade.number = ${target.grade})
         OR (${target.kind} = 'mentor' AND mapping.mentor_user_id = ${target.mentor})
       )`;
}

function targetParams(target: CommonTarget): [string, number | null, number | null] {
  return [
    target.kind,
    target.kind === "grade" ? target.grade : null,
    target.kind === "mentor" ? target.mentorUserId : null,
  ];
}

// How many Students a target reaches now.
async function countTargeted(target: CommonTarget): Promise<number> {
  const rows = await query<{ count: number | string }>(
    `SELECT count(*) AS count FROM (${targetedStudentsSql(
      { kind: "$1::text", grade: "$2::int", mentor: "$3::bigint" },
      "$4"
    )}) targeted`,
    [...targetParams(target), CURRENT_ACADEMIC_YEAR]
  );
  return Number(rows[0]?.count ?? 0);
}

// The preview before pushing a new Common Action Item: "Will be added to N
// students". `raw` is the target (`kind`, `grade`, `mentorUserId`).
export async function previewCommonTarget(
  access: BlendedLearningAccess,
  raw: unknown
): Promise<CommonItemResult<{ count: number }>> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  const target = validateTarget(raw);
  if (!target.ok) return invalid(target.fieldErrors);
  return { ok: true, count: await countTargeted(target.input) };
}

// Mentors with active current-year Mappings, for the Mentor target, A–Z.
export async function listTargetMentors(access: BlendedLearningAccess): Promise<TargetMentor[]> {
  if (!canBlendedLearning(access, "manage")) return [];
  const rows = await query<{ user_id: number | string; name: string; students: number | string }>(
    `SELECT mapping.mentor_user_id AS user_id, ${MENTOR_NAME_SQL("mentor", "mapping.mentor_user_id")} AS name,
            count(*) AS students
     FROM blended_learning_mentor_mentee_mappings mapping
     LEFT JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     WHERE ${activeBlendedMappingSql("mapping", "$1")}
     GROUP BY mapping.mentor_user_id, mentor.first_name, mentor.last_name, mentor.email
     ORDER BY name, mapping.mentor_user_id`,
    [CURRENT_ACADEMIC_YEAR]
  );
  return rows.map((row) => ({ userId: Number(row.user_id), name: row.name, students: Number(row.students) }));
}

type CommonRow = {
  id: number | string;
  text: string;
  owner: CommonItemOwner;
  target_kind: CommonTarget["kind"];
  target_grade: number | string | null;
  target_mentor_user_id: number | string | null;
  target_mentor_name: string | null;
  open_count: number | string;
  done_count: number | string;
  not_yet_added: number | string;
  created_on: string;
};

function rowTarget(row: CommonRow): CommonTarget {
  if (row.target_kind === "grade") return { kind: "grade", grade: Number(row.target_grade) as 12 | 13 };
  if (row.target_kind === "mentor") return { kind: "mentor", mentorUserId: Number(row.target_mentor_user_id) };
  return { kind: "all" };
}

function toCommonItem(row: CommonRow): CommonActionItem {
  return {
    id: Number(row.id),
    text: row.text,
    owner: row.owner,
    target: rowTarget(row),
    targetMentorName: row.target_mentor_name,
    openCount: Number(row.open_count),
    doneCount: Number(row.done_count),
    notYetAdded: Number(row.not_yet_added),
    createdOn: row.created_on,
  };
}

// The Common Action Items still in force, newest first, with their open and
// done counts and how many targeted Students don't have them yet.
export async function listCommonActionItems(access: BlendedLearningAccess): Promise<CommonActionItem[]> {
  if (!canBlendedLearning(access, "manage")) return [];
  const rows = await query<CommonRow>(
    `SELECT common.id, common.text, common.owner, common.target_kind, common.target_grade,
            common.target_mentor_user_id,
            CASE WHEN common.target_mentor_user_id IS NULL THEN NULL
                 ELSE ${MENTOR_NAME_SQL("mentor", "common.target_mentor_user_id")} END AS target_mentor_name,
            (SELECT count(*) FROM blended_learning_action_items item
             WHERE item.common_action_item_id = common.id AND item.status = 'open') AS open_count,
            (SELECT count(*) FROM blended_learning_action_items item
             WHERE item.common_action_item_id = common.id AND item.status = 'done') AS done_count,
            (SELECT count(*) FROM (${targetedStudentsSql(
              { kind: "common.target_kind", grade: "common.target_grade", mentor: "common.target_mentor_user_id" },
              "$1"
            )}) targeted
             WHERE NOT EXISTS (
               SELECT 1 FROM blended_learning_action_items item
               WHERE item.common_action_item_id = common.id AND item.student_id = targeted.student_id
             )) AS not_yet_added,
            ((common.inserted_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on
     FROM blended_learning_common_action_items common
     LEFT JOIN "user" mentor ON mentor.id = common.target_mentor_user_id
     WHERE common.removed_at IS NULL
     ORDER BY common.inserted_at DESC, common.id DESC`,
    [CURRENT_ACADEMIC_YEAR]
  );
  return rows.map(toCommonItem);
}

// Add the Common Action Item, as an open Action Item, to every targeted
// Student who doesn't have it yet. Returns how many were added.
async function materialise(client: PoolClient, commonId: number): Promise<number> {
  const result = await client.query(
    `INSERT INTO blended_learning_action_items (common_action_item_id, student_id, position, owner, text)
     SELECT common.id, targeted.student_id, 1, common.owner, common.text
     FROM blended_learning_common_action_items common
     CROSS JOIN LATERAL (${targetedStudentsSql(
       { kind: "common.target_kind", grade: "common.target_grade", mentor: "common.target_mentor_user_id" },
       "$2"
     )}) targeted
     WHERE common.id = $1 AND common.removed_at IS NULL
     ON CONFLICT (common_action_item_id, student_id) WHERE common_action_item_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [commonId, CURRENT_ACADEMIC_YEAR]
  );
  return result.rowCount ?? result.rows.length;
}

class NoStudents extends Error {}

const NO_STUDENTS_ERRORS: FieldErrors = { target: "No students match this target. Choose another." };

// Save a new Common Action Item and push it to its target, in one
// transaction. A target that reaches no Student saves nothing (422).
export async function createCommonActionItem(
  access: BlendedLearningAccess,
  raw: unknown
): Promise<CommonItemResult<{ id: number; added: number }>> {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  const validated = validateCommonItem(raw);
  if (!validated.ok) return invalid(validated.fieldErrors);
  const { text, owner, target } = validated.input;
  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query<{ id: number | string }>(
        `INSERT INTO blended_learning_common_action_items
           (text, owner, target_kind, target_grade, target_mentor_user_id, created_by_email)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [text, owner, ...targetParams(target), access.actorEmail]
      );
      const id = Number(inserted.rows[0].id);
      const added = await materialise(client, id);
      if (added === 0) throw new NoStudents();
      return { ok: true as const, id, added };
    });
  } catch (error) {
    // An unknown Mentor (23503) reaches no Student either.
    if (error instanceof NoStudents || (error as { code?: string } | null)?.code === "23503") {
      return invalid(NO_STUDENTS_ERRORS);
    }
    throw error;
  }
}

// Lock a Common Action Item still in force, or null.
async function lockActive(client: PoolClient, id: number): Promise<boolean> {
  const result = await client.query(
    `SELECT id FROM blended_learning_common_action_items WHERE id = $1 AND removed_at IS NULL FOR UPDATE`,
    [id]
  );
  return result.rows.length > 0;
}

// A write to one Common Action Item: 403 without `manage`, 404 for an invalid
// id; otherwise null.
function refused(access: BlendedLearningAccess, id: number): Failure | null {
  if (!canBlendedLearning(access, "manage")) return FORBIDDEN;
  return validId(id) ? null : NOT_FOUND;
}

// `write` in one transaction, with the Common Action Item locked; a removed or
// unknown one is a 404.
function withLockedItem<T extends object>(
  id: number,
  write: (client: PoolClient) => Promise<T>
): Promise<CommonItemResult<T>> {
  return withTransaction(async (client) => {
    if (!(await lockActive(client, id))) return NOT_FOUND;
    return { ok: true as const, ...(await write(client)) };
  });
}

// Push again: add it to targeted Students who don't have it yet.
export async function pushCommonActionItem(
  access: BlendedLearningAccess,
  id: number
): Promise<CommonItemResult<{ added: number }>> {
  return refused(access, id) ?? withLockedItem(id, async (client) => ({ added: await materialise(client, id) }));
}

// New text and owner for the Common Action Item and every still-open Action
// Item pushed from it; done ones keep what they were done as.
export async function updateCommonActionItem(
  access: BlendedLearningAccess,
  id: number,
  raw: unknown
): Promise<CommonItemResult<{ updatedOpen: number }>> {
  const refusal = refused(access, id);
  if (refusal) return refusal;
  const validated = validateCommonItemEdit(raw);
  if (!validated.ok) return invalid(validated.fieldErrors);
  const { text, owner } = validated.input;
  return withLockedItem(id, async (client) => {
    await client.query(
      `UPDATE blended_learning_common_action_items SET text = $2, owner = $3, updated_at = now() WHERE id = $1`,
      [id, text, owner]
    );
    const updated = await client.query(
      `UPDATE blended_learning_action_items
       SET text = $2, owner = $3, updated_at = now()
       WHERE common_action_item_id = $1 AND status = 'open'`,
      [id, text, owner]
    );
    return { updatedOpen: updated.rowCount ?? 0 };
  });
}

// Remove the Common Action Item: its still-open Action Items are deleted, done
// ones stay as history, and it is soft-removed with who removed it.
export async function removeCommonActionItem(
  access: BlendedLearningAccess,
  id: number
): Promise<CommonItemResult<{ deletedOpen: number }>> {
  return (
    refused(access, id) ??
    withLockedItem(id, async (client) => {
      await client.query(
        `UPDATE blended_learning_common_action_items
         SET removed_at = now(), removed_by_email = $2, updated_at = now()
         WHERE id = $1`,
        [id, access.actorEmail]
      );
      const deleted = await client.query(
        `DELETE FROM blended_learning_action_items WHERE common_action_item_id = $1 AND status = 'open'`,
        [id]
      );
      return { deletedOpen: deleted.rowCount ?? 0 };
    })
  );
}
