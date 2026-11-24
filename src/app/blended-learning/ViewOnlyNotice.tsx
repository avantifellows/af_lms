import { Eye } from "lucide-react";

// Says whose Students these are and that the viewer can't log for them: a
// team lead on a reportee's list or one of their Mentees' pages.
export function ViewOnlyNotice({
  mentorName,
  students,
}: {
  mentorName: string;
  students: "these students" | "this student";
}) {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-lg border border-border bg-bg-card-alt p-3 text-sm text-text-secondary"
    >
      <Eye aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <span className="font-bold text-text-primary">View only.</span> {mentorName} mentors {students} and logs
        their conversations.
      </span>
    </p>
  );
}
