"use client";

import { ArrowRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Button, Card, FormLabel } from "@/components/ui";
import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { TeamLeadLink, TeamLeadPerson } from "@/lib/blended-learning-team-leads";

import { BlendedSelect } from "../BlendedSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldError } from "./fields";
import { manageRequest } from "./manageRequest";

// The Manage page's Team leads: who leads whom this academic year. A team lead
// lands on cards for themselves and the Mentors they lead, and sees those
// Mentors' Students view only; they never log for them. Add a team lead and a
// Mentor they lead, or end one after a confirmation (the record stays). Every
// change re-reads the page.

type Errors = Record<string, string>;

function linkLabel(link: TeamLeadLink): string {
  return `${link.teamLead.name} → ${link.reportee.name}`;
}

function MentorSelect({
  label,
  value,
  onChange,
  mentors,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mentors: TeamLeadPerson[];
  error?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <BlendedSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <option value="">Choose a mentor</option>
        {mentors.map((mentor) => (
          <option key={mentor.userId} value={mentor.userId}>
            {mentor.name}
          </option>
        ))}
      </BlendedSelect>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function AddTeamLeadForm({ mentors }: { mentors: TeamLeadPerson[] }) {
  const router = useRouter();
  const [lead, setLead] = useState("");
  const [reportee, setReportee] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await manageRequest("/api/blended-learning/team-leads", {
      method: "POST",
      body: { supervisorUserId: lead, mentorUserId: reportee },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(Object.keys(result.fieldErrors).length > 0 ? result.fieldErrors : { form: result.error });
      return;
    }
    setErrors({});
    setLead("");
    setReportee("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} aria-label="Add a team lead" className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-bold text-text-primary">Add a team lead</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <MentorSelect label="Team lead" value={lead} onChange={setLead} mentors={mentors} error={errors.supervisorUserId} />
        <MentorSelect
          label="Mentor they lead"
          value={reportee}
          onChange={setReportee}
          mentors={mentors}
          error={errors.mentorUserId}
        />
      </div>
      {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
      <Button type="submit" disabled={busy} className="w-full sm:w-auto">
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add team lead
      </Button>
    </form>
  );
}

function LinkRow({ link, busy, onEnd }: { link: TeamLeadLink; busy: boolean; onEnd: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-text-primary">
          <span>{link.teamLead.name}</span>
          <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="sr-only">leads</span>
          <span>{link.reportee.name}</span>
        </p>
        <p className="text-xs text-text-muted">
          Since <span className="font-mono">{formatCalendarDate(link.startedOn)}</span>
        </p>
      </div>
      <Button type="button" variant="secondary" className="shrink-0" aria-label={`End ${linkLabel(link)}`} disabled={busy} onClick={onEnd}>
        End
      </Button>
    </div>
  );
}

// Ending one: a confirmation, then the request, then the page re-reads.
function useEndLink() {
  const router = useRouter();
  const [ending, setEnding] = useState<TeamLeadLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!ending) return;
    setBusy(true);
    setError(null);
    const result = await manageRequest(`/api/blended-learning/team-leads/${ending.id}/end`, { method: "POST" });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEnding(null);
    router.refresh();
  }

  function cancel() {
    setEnding(null);
    setError(null);
  }

  return { ending, setEnding, busy, error, confirm, cancel };
}

export function TeamLeadsManager({ links, mentors }: { links: TeamLeadLink[]; mentors: TeamLeadPerson[] }) {
  const end = useEndLink();
  const { ending } = end;

  return (
    <section aria-labelledby="manage-team-leads">
      <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 id="manage-team-leads" className="text-lg font-bold text-text-primary">
            Team leads
          </h2>
          <p className="text-sm text-text-secondary">
            A team lead opens Blended Learning on cards for themselves and the mentors they lead, and sees those
            mentors&apos; students view only. They never log for them.
          </p>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-text-secondary">No team leads yet.</p>
        ) : (
          <ul aria-label="Team leads" className="divide-y divide-border">
            {links.map((link) => (
              <li key={link.id} className="py-3 first:pt-0">
                <LinkRow link={link} busy={end.busy} onEnd={() => end.setEnding(link)} />
              </li>
            ))}
          </ul>
        )}
        <AddTeamLeadForm mentors={mentors} />
      </Card>
      <ConfirmDialog
        open={ending !== null}
        title="End this team lead?"
        confirmLabel="End"
        danger
        busy={end.busy}
        error={end.error}
        onConfirm={end.confirm}
        onCancel={end.cancel}
      >
        <p>
          <span className="font-bold text-text-primary">{ending?.teamLead.name}</span> will no longer see{" "}
          <span className="font-bold text-text-primary">{ending?.reportee.name}</span>&apos;s students. The record
          is kept.
        </p>
      </ConfirmDialog>
    </section>
  );
}
