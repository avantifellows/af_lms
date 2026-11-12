import Link from "next/link";
import { Eye } from "lucide-react";

import type { SupervisedMentor } from "@/lib/blended-learning-mentees";

// A supervisor's switch between their own Mentee list and each supervised
// Mentor's (`/blended-learning?mentor=<id>`, as an admin's Flags filter does).
// A supervised Mentor's list is view only: that Mentor logs for their Mentees.

export function supervisedListHref(mentorUserId: number | null): string {
  return mentorUserId === null ? "/blended-learning" : `/blended-learning?mentor=${mentorUserId}`;
}

function SwitchLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-bold ${
        active
          ? "border-accent bg-accent text-text-on-accent"
          : "border-border bg-bg-card text-text-secondary hover:border-accent hover:text-text-primary"
      }`}
    >
      {label}
    </Link>
  );
}

export function SupervisedMentorSwitch({
  mentors,
  viewing,
}: {
  mentors: SupervisedMentor[];
  // The supervised Mentor whose list is open, or null for the viewer's own.
  viewing: SupervisedMentor | null;
}) {
  return (
    <div className="space-y-3">
      <nav aria-label="Whose students" className="flex flex-wrap gap-2">
        <SwitchLink href={supervisedListHref(null)} active={viewing === null} label="My students" />
        {mentors.map((mentor) => (
          <SwitchLink
            key={mentor.mentorUserId}
            href={supervisedListHref(mentor.mentorUserId)}
            active={viewing?.mentorUserId === mentor.mentorUserId}
            label={`${mentor.name}'s students`}
          />
        ))}
      </nav>
      {viewing && <ViewOnlyNotice mentorName={viewing.name} students="these students" />}
    </div>
  );
}

// Says whose Students these are and that the viewer can't log for them.
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
