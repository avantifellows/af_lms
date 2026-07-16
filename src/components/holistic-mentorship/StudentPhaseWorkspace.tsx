import Link from "next/link";

import type { HolisticStudentPhaseDetail } from "@/lib/holistic-student-phase";
import GuidancePreview from "./GuidancePreview";

export default function StudentPhaseWorkspace({
  detail,
  schoolCode,
  academicYear,
}: {
  detail: HolisticStudentPhaseDetail;
  schoolCode: string;
  academicYear: string;
}) {
  const selected = detail.selectedPhase;
  const openSelected = "locked" in selected && !selected.locked && "guidanceMarkdown" in selected
    ? selected
    : null;
  const phaseHref = (phaseId: number) =>
    `/holistic-mentorship/students/${detail.student.id}/phases/${phaseId}?${new URLSearchParams({
      school_code: schoolCode,
      academic_year: academicYear,
    })}`;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{detail.student.name}</h1>
          <p className="text-sm text-text-muted">
            Grade {detail.student.grade}
            {detail.student.externalStudentId ? ` · ${detail.student.externalStudentId}` : ""}
          </p>
        </div>
        {detail.readOnly && <span className="text-sm font-medium text-text-muted">Read-only</span>}
      </header>

      <nav aria-label="Holistic Phases" className="flex gap-2 overflow-x-auto pb-2">
        {detail.phases.map((phase) => {
          const label = `Phase ${phase.number} - ${phase.title}`;
          if (phase.phaseId === null || ("locked" in phase && phase.locked)) {
            return (
              <button key={`${phase.number}-${phase.title}`} type="button" disabled
                className="min-h-11 shrink-0 rounded-md border border-border bg-bg-card-alt px-3 text-left text-sm text-text-muted opacity-60">
                <span className="block font-semibold">Phase {phase.number}</span>
                <span className="block max-w-40 truncate text-xs">{phase.title}</span>
              </button>
            );
          }
          const current = phase.phaseId === selected.phaseId;
          return (
            <Link key={phase.phaseId} href={phaseHref(phase.phaseId)} aria-label={label}
              className={`min-h-11 shrink-0 rounded-md border px-3 py-2 text-sm ${current
                ? "border-accent bg-accent text-text-on-accent"
                : "border-border bg-bg-card text-text-secondary hover:bg-hover-bg"}`}>
              <span className="block font-semibold">Phase {phase.number}</span>
              <span className="block max-w-40 truncate text-xs">{phase.title}</span>
            </Link>
          );
        })}
      </nav>

      {!openSelected ? (
        <p className="border-y border-border py-10 text-center text-sm text-text-muted">
          This Phase is locked.
        </p>
      ) : (
        <>
          <section aria-labelledby="phase-heading" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="phase-heading" className="text-xl font-semibold text-text-primary">
                Phase {openSelected.number}: {openSelected.title}
              </h2>
              {openSelected.active && <span className="rounded bg-success/10 px-2 py-1 text-xs font-semibold text-success">Active</span>}
              <span className="rounded bg-bg-card-alt px-2 py-1 text-xs font-semibold text-text-secondary">
                {openSelected.progress[0].toUpperCase() + openSelected.progress.slice(1)}
              </span>
              {openSelected.draftSaved && <span className="text-xs font-medium text-text-muted">Draft saved</span>}
            </div>
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="context-heading" className="space-y-4 border-t border-border pt-4">
              <div>
                <h2 id="context-heading" className="text-lg font-semibold text-text-primary">Student Context</h2>
                {openSelected.context.label && <p className="text-sm font-medium text-accent">{openSelected.context.label}</p>}
                {"lastUpdatedAt" in openSelected.context && openSelected.context.lastUpdatedAt && (
                  <p className="text-xs text-text-muted">Last updated {formatDate(openSelected.context.lastUpdatedAt)}</p>
                )}
              </div>
              {"missing" in openSelected.context ? (
                <p className="text-sm text-text-muted">{openSelected.context.missing}</p>
              ) : (
                <dl className="space-y-4">
                  {openSelected.context.items.map((item, index) => (
                    <div key={`${item.label}-${index}`}>
                      <dt className="text-sm font-semibold text-text-secondary">{item.label}</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-primary">{item.content}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section aria-labelledby="guidance-heading" className="space-y-4 border-t border-border pt-4">
              <h2 id="guidance-heading" className="text-lg font-semibold text-text-primary">Phase Guidance</h2>
              <GuidancePreview markdown={openSelected.guidanceMarkdown} />
            </section>
          </div>

          <section aria-labelledby="notes-heading" className="space-y-4 border-t border-border pt-4">
            <h2 id="notes-heading" className="text-lg font-semibold text-text-primary">Post-Session Notes</h2>
            {openSelected.notes && (
              <p className="text-xs text-text-muted">
                {openSelected.notes.firstSubmittedAt ? `Submitted ${formatDate(openSelected.notes.firstSubmittedAt)}` : "Draft saved"}
                {` · Last edited ${formatDate(openSelected.notes.lastEditedAt)}`}
              </p>
            )}
            {openSelected.questions.map((question) => {
              const answer = openSelected.notes?.answers?.find((item) => item.questionId === question.questionId)?.answer;
              return (
                <div key={question.questionId}>
                  <h3 className="text-sm font-semibold text-text-secondary">{question.text}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{answer || "Not submitted"}</p>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
