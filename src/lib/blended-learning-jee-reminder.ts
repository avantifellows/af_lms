import type { PoolClient } from "pg";

import { JEE_FORM_REMINDER_TEXT } from "./blended-learning-jee-form-input";

// The "JEE Form Filling (Reminder)" Common Action Item (server-only). It is
// matched on its Common Action Item's text, case and runs of spaces ignored,
// so no id is hard-coded. Only the JEE form ticks it: recording Filled (or
// saving Filled again) ticks an open one (blended-learning-jee-form), and a
// push to a Student whose latest update is already Filled adds it done
// (blended-learning-common-action-items). A Conversation can't, so it stays
// open while the form is Not recorded or Not filled, and it is never unticked.

// `common` is the blended_learning_common_action_items alias; `textParam` the
// placeholder bound to JEE_FORM_REMINDER_TEXT.
export function jeeReminderMatchSql(common: string, textParam: string): string {
  return `lower(regexp_replace(btrim(${common}.text), '\\s+', ' ', 'g')) = lower(${textParam})`;
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
    [ids, studentId, JEE_FORM_REMINDER_TEXT]
  );
  return result.rows.map((row) => Number(row.id));
}
