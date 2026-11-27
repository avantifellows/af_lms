import type { PoolClient } from "pg";

import { JEE_FORM_REMINDER_TEXT } from "./blended-learning-jee-form-input";

// The "JEE Form Filling (Reminder)" Common Action Item (server-only). It is
// found by a hidden, fixed key, `blended_learning_common_action_items.key =
// 'jee_form_reminder'` (db-service 20261124142920), never by its text, so the
// program team can rename it on the Manage page and the JEE form still ticks
// it. Admins never see or set the key: the migration keyed the existing
// reminder, and creating a Common Action Item whose text is the reminder's
// (case and spacing aside) while no active one holds the key gives it the key
// (createCommonActionItem), so a removed and re-created reminder is linked
// again. Editing never sets or clears the key. An item with the reminder's text but no key is an
// ordinary Common Action Item.
//
// Only the JEE form ticks it: recording Filled (or saving Filled again) ticks
// an open one (blended-learning-jee-form), and a push to a Student whose
// latest update is already Filled adds it done
// (blended-learning-common-action-items). A Conversation can't, so it stays
// open while the form is Not recorded or Not filled, and it is never unticked.

export const JEE_FORM_REMINDER_KEY = "jee_form_reminder";

// For joining an Action Item to its Common Action Item: the key alone, so a
// removed reminder's Action Items (done ones stay as history) still count.
// `common` is the blended_learning_common_action_items alias; `keyParam` the
// placeholder bound to JEE_FORM_REMINDER_KEY.
export function jeeReminderMatchSql(common: string, keyParam: string): string {
  return `${common}.key = ${keyParam}`;
}

// For looking up the reminder itself: the active one holding the key (a
// removed one keeps its key as history but no longer holds it).
export function activeJeeReminderSql(common: string, keyParam: string): string {
  return `${common}.key = ${keyParam} AND ${common}.removed_at IS NULL`;
}

// Whether `text` is the reminder's, case and runs of spaces ignored, as the
// db-service migration matched it when it keyed the existing reminder.
export function isJeeReminderText(text: string): boolean {
  return text.trim().replace(/\s+/g, " ").toLowerCase() === JEE_FORM_REMINDER_TEXT.toLowerCase();
}

// The Student's latest JEE form update for the current sitting (JEE_FORM_EXAM)
// as `id` and `recorded_by_email`, only when it is Filled; no row otherwise.
// For a LATERAL join: `studentId` is the SQL for the Student's id, and
// `examNameParam` / `examYearParam` the placeholders bound to
// JEE_FORM_EXAM.examName and .examYear.
export function latestFilledJeeUpdateSql(studentId: string, examNameParam: string, examYearParam: string): string {
  return `SELECT latest.id, latest.recorded_by_email
     FROM (
       SELECT u.id, u.status, u.recorded_by_email
       FROM blended_learning_jee_form_updates u
       WHERE u.student_id = ${studentId}
         AND u.exam_id = (SELECT exam.id FROM exam WHERE exam.name = ${examNameParam} ORDER BY exam.id LIMIT 1)
         AND u.exam_year = ${examYearParam}
       ORDER BY u.id DESC
       LIMIT 1
     ) latest
     WHERE latest.status = 'filled'`;
}

export const JEE_REMINDER_TICK_REFUSED =
  "“JEE Form Filling (Reminder)” is ticked only by recording the JEE form as Filled in the JEE Form tab. Reload and save again.";

// Which of `ids` are this Student's reminder items (open or done), inside a
// write's transaction.
export async function jeeReminderItemIds(client: PoolClient, studentId: number, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const result = await client.query<{ id: number | string }>(
    `SELECT item.id
     FROM blended_learning_action_items item
     JOIN blended_learning_common_action_items common ON common.id = item.common_action_item_id
     WHERE item.id = ANY($1::bigint[]) AND item.student_id = $2 AND ${jeeReminderMatchSql("common", "$3")}`,
    [ids, studentId, JEE_FORM_REMINDER_KEY]
  );
  return result.rows.map((row) => Number(row.id));
}
