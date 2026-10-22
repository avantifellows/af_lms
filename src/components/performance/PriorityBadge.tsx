// Stream-keyed chapter priority (resolved upstream by etl-next). Untagged
// chapters render an em-dash so a column reads cleanly until the curriculum
// team finishes tagging. Shared by the chapter analysis, the chapter-test cards
// and the chapter-test report.
export default function PriorityBadge({
  priority,
  suffix = "",
}: {
  priority: string | null;
  /** Appended to the label, e.g. " priority" on the cards. */
  suffix?: string;
}) {
  if (!priority || priority === "None") {
    return <span className="text-text-muted">—</span>;
  }
  const cls =
    priority === "High"
      ? "bg-danger-bg text-danger"
      : priority === "Medium"
        ? "bg-warning-bg text-text-primary"
        : "bg-success-bg text-text-primary";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${cls}`}>
      {priority}
      {suffix}
    </span>
  );
}
