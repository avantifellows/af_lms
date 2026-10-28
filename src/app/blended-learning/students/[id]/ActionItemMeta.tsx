import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { ActionItemOwner } from "@/lib/blended-learning-mentee-detail";

// Who owns an Action Item and when it was agreed. Used by the detail page's
// history and Open Action Items, and by the log form.

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

// Marks an Action Item a Blended Learning Admin pushed to many Students (a
// Common Action Item, labelled "From program") rather than one agreed in a
// Conversation.
function CommonTag() {
  return (
    <span className="mr-1.5 inline-block rounded-md bg-hover-bg px-1.5 text-xs font-bold leading-5 text-accent">
      From program
    </span>
  );
}

// The owner and the agreeing Conversation's date, as one muted line. A
// Common Action Item gets its tag and the date it was added instead.
export function ActionItemMeta({
  owner,
  agreedOn,
  common = false,
}: {
  owner?: ActionItemOwner;
  agreedOn?: string;
  common?: boolean;
}) {
  const date = agreedOn ? `${common ? "Added" : "From"} ${formatCalendarDate(agreedOn)}` : null;
  const parts = [owner ? ACTION_ITEM_OWNER[owner] : null, date].filter((part): part is string => Boolean(part));
  if (parts.length === 0 && !common) return null;
  return (
    <span className="block text-xs text-text-muted">
      {common && <CommonTag />}
      {parts.join(" · ")}
    </span>
  );
}
