import { describe, expect, it, vi } from "vitest";

import {
  JEE_FORM_REMINDER_KEY,
  activeJeeReminderSql,
  isJeeReminderText,
  jeeReminderItemIds,
  jeeReminderMatchSql,
} from "./blended-learning-jee-reminder";

describe("the JEE reminder's key", () => {
  it("is the fixed key db-service gave the reminder", () => {
    expect(JEE_FORM_REMINDER_KEY).toBe("jee_form_reminder");
    // db-service's CHECK: lowercase letters, digits and underscores, starting with a letter.
    expect(JEE_FORM_REMINDER_KEY).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("matches an Action Item's Common Action Item on the key alone, as a placeholder", () => {
    expect(jeeReminderMatchSql("common", "$3")).toBe("common.key = $3");
  });

  it("looks up the reminder itself as the active item holding the key", () => {
    expect(activeJeeReminderSql("held", "$8")).toBe("held.key = $8 AND held.removed_at IS NULL");
  });

  it("recognises the reminder's text with case and runs of spaces ignored, as db-service keyed it", () => {
    for (const text of ["JEE Form Filling (Reminder)", "jee form filling (reminder)", "  JEE   Form\tFilling (REMINDER) "]) {
      expect(isJeeReminderText(text)).toBe(true);
    }
    for (const text of ["JEE Form Filling", "JEE Form Filling (Reminder) now", "JEE FormFilling (Reminder)"]) {
      expect(isJeeReminderText(text)).toBe(false);
    }
  });
});

describe("jeeReminderItemIds", () => {
  it("binds the ids, the Student and the key, and never matches on the text", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "805" }] }));
    expect(await jeeReminderItemIds({ query } as never, 501, [802, 805])).toEqual([805]);
    const [[sql, params]] = query.mock.calls as unknown as [string, unknown[]][];
    expect(params).toEqual([[802, 805], 501, "jee_form_reminder"]);
    expect(sql).toMatch(/WHERE item\.id = ANY\(\$1::bigint\[\]\) AND item\.student_id = \$2 AND common\.key = \$3$/);
    expect(sql).not.toMatch(/common\.text|jee_form_reminder/);
  });

  it("reads nothing for no ids", async () => {
    const query = vi.fn();
    expect(await jeeReminderItemIds({ query } as never, 501, [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
