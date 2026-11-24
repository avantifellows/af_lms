import Link from "next/link";

import { Card } from "@/components/ui";
import { JEE_FORM_EXAM, type JeeFormLineView } from "@/lib/blended-learning-jee-form-input";

import { JeeStatusBadge, JeeStatusDetail, RecordedOn, jeeTabHref } from "../../jee-form/jeeFormDisplay";

// The Mentee page's JEE form line: the current status (with the application
// number or the Not filled reasons) and a link to this Student's row in the
// JEE Form tab, where the Mentor records it ("View in JEE tab" for anyone
// else: admins and read-only accounts only view it). A team lead on a
// supervised Mentor's Mentee gets the status only (JeeStatusOnlyView: Filled
// or Not filled with its reasons, and the date), never the application number.

// One per page, so a fixed id is enough (no hooks: a Server Component).
const TITLE_ID = "jee-form-status-title";

export function JeeTabLink({ studentId, children }: { studentId: number; children: string }) {
  return (
    <Link
      href={jeeTabHref(studentId)}
      className="inline-flex min-h-11 items-center whitespace-nowrap rounded text-sm font-bold text-accent underline-offset-2 hover:text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:min-h-8"
    >
      {children}
      <span aria-hidden="true">&nbsp;→</span>
    </Link>
  );
}

function linkLabel(form: JeeFormLineView | null, canRecord: boolean): string {
  if (!canRecord) return "View in JEE tab";
  return form?.current ? "Update in JEE tab" : "Fill in JEE tab";
}

export function JeeFormStatusLine({
  studentId,
  form,
  canRecord,
}: {
  studentId: number;
  form: JeeFormLineView | null;
  canRecord: boolean;
}) {
  const current = form?.current ?? null;
  return (
    <section aria-labelledby={TITLE_ID}>
      <Card elevation="sm" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-1 text-sm">
          <h2 id={TITLE_ID} className="text-xs font-bold uppercase tracking-wide text-text-muted">
            {JEE_FORM_EXAM.label} form
          </h2>
          {form ? <JeeStatusBadge current={current} /> : <span className="text-text-secondary">Can&apos;t be shown right now</span>}
          <JeeStatusDetail current={current} />
          <RecordedOn current={current} />
        </div>
        <JeeTabLink studentId={studentId}>{linkLabel(form, canRecord)}</JeeTabLink>
      </Card>
    </section>
  );
}
