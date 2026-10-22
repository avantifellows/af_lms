import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { ActionItemOwner } from "@/lib/blended-learning-mentee-detail";

// Who owns an Action Item and when it was agreed. Action Items have no due
// date in the product, so a stored `due_on` is never shown. Used by the
// detail page's history and Open Action Items, and by the log form.

export const ACTION_ITEM_OWNER: Record<ActionItemOwner, string> = {
  student: "Student",
  mentor: "Mentor",
  parent: "Parent",
};

// The owner as a small pill, set before the item's text.
export function OwnerPill({ owner }: { owner: ActionItemOwner }) {
  return (
    <span className="inline-block shrink-0 rounded-md border border-border bg-bg-card-alt px-1.5 text-xs font-bold leading-5 text-text-primary">
      {ACTION_ITEM_OWNER[owner]}
    </span>
  );
}

// The owner and the agreeing Conversation's date, as one muted line.
// `dueOn` is accepted for callers that still pass it, and ignored.
export function ActionItemMeta({
  owner,
  agreedOn,
}: {
  owner?: ActionItemOwner;
  dueOn?: string | null;
  agreedOn?: string;
}) {
  const parts = [owner ? ACTION_ITEM_OWNER[owner] : null, agreedOn ? `From ${formatCalendarDate(agreedOn)}` : null].filter(
    (part): part is string => Boolean(part)
  );
  if (parts.length === 0) return null;
  return <span className="block text-xs text-text-muted">{parts.join(" · ")}</span>;
}
