import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { ActionItemOwner } from "@/lib/blended-learning-mentee-detail";

// Who owns an Action Item and when it is due, as one muted line. Used by the
// detail page's history and Open Action Items, and by the log form.

export const ACTION_ITEM_OWNER: Record<ActionItemOwner, string> = {
  student: "Student",
  mentor: "Mentor",
  parent: "Parent",
};

export function ActionItemMeta({
  owner,
  dueOn,
  agreedOn,
}: {
  owner: ActionItemOwner;
  dueOn: string | null;
  agreedOn?: string;
}) {
  const parts = [
    ACTION_ITEM_OWNER[owner],
    dueOn ? `Due ${formatCalendarDate(dueOn)}` : null,
    agreedOn ? `From ${formatCalendarDate(agreedOn)}` : null,
  ].filter((part): part is string => Boolean(part));
  return <span className="block text-xs text-text-muted">{parts.join(" · ")}</span>;
}
