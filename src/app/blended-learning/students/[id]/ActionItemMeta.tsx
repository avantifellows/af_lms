import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { ActionItemOwner, ActionItemSource } from "@/lib/blended-learning-mentee-detail";

// Who owns an Action Item and when it was agreed. Used by the detail page's
// history and Open Action Items, and by the log form.

export const ACTION_ITEM_OWNER: Record<ActionItemOwner, string> = {
  student: "Student",
  mentor: "Mentor",
  parent: "Parent",
};

// The owner as a small pill, set before the item's text. Every pill is as
// wide as the widest ("Student"), so the text beside it starts at the same
// x whoever owns the item.
export function OwnerPill({ owner }: { owner: ActionItemOwner }) {
  return (
    <span className="inline-block w-16 shrink-0 rounded-md border border-border bg-bg-card-alt px-1 text-center text-xs font-bold leading-5 text-text-primary">
      {ACTION_ITEM_OWNER[owner]}
    </span>
  );
}

// Marks an Action Item a Blended Learning Admin pushed to many Students (a
// Common Action Item, labelled "From program") rather than one agreed in a
// Conversation or brought over from the Profile Doc.
function CommonTag() {
  return (
    <span className="mr-1.5 inline-block rounded-md bg-hover-bg px-1.5 text-xs font-bold leading-5 text-accent">
      From program
    </span>
  );
}

// The pill, then the text with anything under it (such as the meta line),
// in a fixed first column.
export const ACTION_ITEM_ROW_CLASSES = "grid grid-cols-[4rem_minmax(0,1fr)] items-baseline gap-x-2.5";

// Where the item came from and its date, as one muted line: "From 14 Jun
// 2026" (a Conversation), "From Profile Doc · 14 Jun 2026", or a Common
// Action Item's tag and "Added 14 Jun 2026".
export function ActionItemMeta({
  owner,
  agreedOn,
  source = "conversation",
}: {
  owner?: ActionItemOwner;
  agreedOn?: string;
  source?: ActionItemSource;
}) {
  const common = source === "common";
  const from = source === "profile_doc" ? "From Profile Doc" : null;
  const date = agreedOn ? formatCalendarDate(agreedOn) : null;
  const parts = [
    owner ? ACTION_ITEM_OWNER[owner] : null,
    from,
    date && (from ? date : `${common ? "Added" : "From"} ${date}`),
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0 && !common) return null;
  return (
    <span className="block text-xs text-text-muted">
      {common && <CommonTag />}
      {parts.join(" · ")}
    </span>
  );
}
