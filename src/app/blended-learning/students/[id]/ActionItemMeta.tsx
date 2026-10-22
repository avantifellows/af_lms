import type { ActionItemOwner } from "@/lib/blended-learning-mentee-detail";

// Who owns an Action Item and when it is due, as one muted line. Used by the
// detail page's history and Open Action Items, and by the log form.

export const ACTION_ITEM_OWNER: Record<ActionItemOwner, string> = {
  student: "Student",
  mentor: "Mentor",
  parent: "Parent",
};

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

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
    dueOn ? `Due ${formatDate(dueOn)}` : null,
    agreedOn ? `From ${formatDate(agreedOn)}` : null,
  ].filter((part): part is string => Boolean(part));
  return <span className="block text-xs text-text-muted">{parts.join(" · ")}</span>;
}
