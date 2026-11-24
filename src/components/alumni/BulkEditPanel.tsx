"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui";
import { FormSectionBlock } from "./AlumniForm";
import { ALUMNI_FIELDS, ALUMNI_SECTIONS, type FieldDef, type SectionDef, type Values } from "@/lib/alumni/fields";
import { checkContext, reviewValues } from "@/lib/alumni/validation";
import { distinctWarnings, type BulkCommon, type BulkResult, type BulkTarget } from "@/lib/alumni/bulk-types";

// Bulk edit: the alumni form's flow, filled in once for every selected
// student. Check first (nothing is written), then save — students without a
// record get one (a bulk upload), the rest are updated. Blank answers leave a
// student's record as it is; a different value already on record is kept
// unless "replace" is ticked.
//
// It starts from what the students already have: answers every one of them
// has (the same, or different) are folded away (a pencil reopens one), so the
// form opens at what's missing. A section opens when it applies to any of
// them by their own record (e.g. UG for students already Studying), and the
// server applies each answer only where it fits that student.

export type BulkStudent = BulkTarget & { name: string };

interface Props {
  students: BulkStudent[];
  /** After saving: reload the table and clear the selection. */
  onDone: () => void;
}

/** Students per request (the server takes at most 25). */
const CHUNK = 10;

type Stage = "edit" | "checking" | "preview" | "saving" | "done";

const LABEL = new Map(ALUMNI_FIELDS.map((f) => [f.column, f.label]));
const NO_COMMON: BulkCommon = { total: 0, common: {}, names: {}, mixed: {}, gates: [] };
const FIELD_SECTION = new Map(ALUMNI_SECTIONS.flatMap((s) => s.fields.map((f) => [f.column, s] as const)));

/** The form's rule for a field, ignoring whether it holds a value. */
const applies = (section: SectionDef, field: FieldDef, v: Values) =>
  (section.showWhen ? section.showWhen(v) : true) && (field.showWhen ? field.showWhen(v) : true);

/**
 * Each student's answers as the flow sees them: what's typed, but their own
 * record's answers win (bulk answers fill blanks) unless the person chose to
 * replace (`overwrite`, or a reopened field).
 */
function studentViews(gates: Values[], typed: Values, overwrite: boolean, reopened: Set<string>): Values[] {
  return (gates.length ? gates : [{}]).map((own) => {
    const v: Values = { ...typed };
    for (const [column, saved] of Object.entries(own)) {
      const replacing = !!typed[column] && (overwrite || reopened.has(column));
      if (saved && !replacing) v[column] = saved;
    }
    return v;
  });
}

/** Does this field apply to at least one of the students? */
const appliesToAny = (column: string, views: Values[]) => {
  const section = FIELD_SECTION.get(column);
  const field = section?.fields.find((f) => f.column === column);
  return !!section && !!field && views.some((v) => applies(section, field, v));
};

/**
 * The answers to send: typed ones that apply to someone and aren't already
 * every student's answer. `replace`: those changed from a shared answer.
 */
function answersToSend(typed: Values, common: Values, views: Values[]): { answers: Values; replace: string[] } {
  const answers: Values = {};
  for (const [column, v] of Object.entries(typed)) {
    if (v.trim() && v.trim() !== (common[column] ?? "") && appliesToAny(column, views)) answers[column] = v.trim();
  }
  return { answers, replace: Object.keys(answers).filter((c) => common[c]) };
}

/** What the students already have on record (shared and differing answers). */
function useCommon(students: BulkStudent[]) {
  const [start, setStart] = useState<BulkCommon | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alumni/bulk/common", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: students.map(({ kind, id }) => ({ kind, id })) }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error);
        if (!cancelled) setStart(body);
      } catch {
        // Not fatal: start from a blank form.
        if (!cancelled) {
          setError("Couldn't load what they already have, so the form starts blank.");
          setStart(NO_COMMON);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [students]);
  return { start, error };
}

/**
 * A section split into answers every student already has (folded) and the
 * fields still to fill. `open` has its show-rules removed: what applies was
 * worked out per student here.
 */
function splitSection(section: SectionDef, views: Values[], start: BulkCommon, typed: Values, reopened: Set<string>) {
  const shown = section.fields.filter((f) => views.some((v) => applies(section, f, v)));
  const filledForAll = (column: string) =>
    !reopened.has(column) && !typed[column] && start.total > 0 && (!!start.common[column] || start.mixed[column] === start.total);
  const open = shown.filter((f) => !filledForAll(f.column));
  return {
    folded: shown.filter((f) => filledForAll(f.column)).map((f) => f.column),
    open: { ...section, showWhen: undefined, fields: open.map((f) => ({ ...f, showWhen: undefined })) },
    hasOpen: open.length > 0,
  };
}

/** Sends the students in chunks, one after another, reporting progress. */
async function runInChunks(
  students: BulkStudent[],
  body: { values: Values; replace: string[]; confirmed: string[]; overwrite: boolean; dryRun: boolean },
  onProgress: (done: number) => void,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  const names = new Map(students.map((s) => [`${s.kind}-${s.id}`, s.name]));
  for (let i = 0; i < students.length; i += CHUNK) {
    const chunk = students.slice(i, i + CHUNK);
    const targets = chunk.map(({ kind, id }) => ({ kind, id }));
    let chunkResults: BulkResult[];
    try {
      const res = await fetch("/api/alumni/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, targets }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't reach the server.");
      chunkResults = json.results;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't reach the server.";
      chunkResults = targets.map((target) => ({ target, name: "", result: "error", message, changed: [], kept: [] }));
    }
    for (const r of chunkResults) results.push({ ...r, name: r.name || names.get(`${r.target.kind}-${r.target.id}`) || "" });
    onProgress(Math.min(i + CHUNK, students.length));
  }
  return results;
}

const count = (results: BulkResult[], ...kinds: BulkResult["result"][]) => results.filter((r) => kinds.includes(r.result)).length;

export default function BulkEditPanel({ students, onDone }: Props) {
  const { start, error: startError } = useCommon(students);
  if (!start) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Looking at what these {students.length} students already have…
      </p>
    );
  }
  return <BulkEditor students={students} start={start} startError={startError} onDone={onDone} />;
}

/** The answers being filled in, and what they mean for each student. `onEdit`: an answer changed. */
function useBulkAnswers(start: BulkCommon, onEdit: () => void) {
  const common = start.common;
  /** What the person typed or picked (shared answers aren't in here unless changed). */
  const [typed, setTyped] = useState<Values>({});
  const [reopened, setReopened] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>(start.names);
  const [overwrite, setOverwriteState] = useState(false);

  const values = useMemo(() => ({ ...common, ...typed }), [common, typed]);
  const views = useMemo(() => studentViews(start.gates, typed, overwrite, reopened), [start.gates, typed, overwrite, reopened]);
  const errors = useMemo(() => reviewValues(typed, common, checkContext({})).errors, [typed, common]);
  const { answers, replace } = useMemo(() => answersToSend(typed, common, views), [typed, common, views]);
  const sections = ALUMNI_SECTIONS.map((s) => ({ section: s, ...splitSection(s, views, start, typed, reopened) }));

  return {
    common, values, names, overwrite, errors, answers, replace, sections,
    folded: sections.flatMap((s) => s.folded),
    setValue: (column: string, value: string) => {
      setTyped((prev) => ({ ...prev, [column]: value }));
      onEdit();
    },
    setName: (column: string, name: string) => setNames((prev) => ({ ...prev, [column]: name })),
    setOverwrite: (on: boolean) => {
      setOverwriteState(on);
      onEdit();
    },
    reopen: (column: string) => setReopened((prev) => new Set(prev).add(column)),
  };
}

type Answers = Pick<ReturnType<typeof useBulkAnswers>, "answers" | "replace" | "overwrite">;

/** Check (nothing written), then save the students the check says can be saved. */
function useBulkRun(students: BulkStudent[]) {
  const [stage, setStage] = useState<Stage>("edit");
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<BulkResult[]>([]);
  const [saved, setSaved] = useState<BulkResult[]>([]);
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const warnings = distinctWarnings(preview);
  const toSave = preview.filter((r) => r.result === "create" || r.result === "update" || (acceptWarnings && r.result === "confirm"));

  const check = async ({ answers, replace, overwrite }: Answers) => {
    setStage("checking");
    setProgress(0);
    setAcceptWarnings(false);
    setPreview(await runInChunks(students, { values: answers, replace, confirmed: [], overwrite, dryRun: true }, setProgress));
    setStage("preview");
  };

  const save = async ({ answers, replace, overwrite }: Answers) => {
    const keys = new Set(toSave.map((r) => `${r.target.kind}-${r.target.id}`));
    const chosen = students.filter((s) => keys.has(`${s.kind}-${s.id}`));
    setStage("saving");
    setProgress(0);
    const confirmed = acceptWarnings ? warnings.map((w) => w.id) : [];
    setSaved(await runInChunks(chosen, { values: answers, replace, confirmed, overwrite, dryRun: false }, setProgress));
    setStage("done");
  };

  return {
    stage, progress, preview, saved, warnings, toSave, acceptWarnings, setAcceptWarnings, check, save,
    edited: () => setStage("edit"),
    busy: stage === "checking" || stage === "saving",
    /** Students in the step running now. */
    total: stage === "saving" ? toSave.length : students.length,
  };
}

function BulkEditor({ students, start, startError, onDone }: Props & { start: BulkCommon; startError: string }) {
  const run = useBulkRun(students);
  const form = useBulkAnswers(start, run.edited);

  if (run.stage === "done") return <DoneView results={run.saved} onClose={onDone} />;

  return (
    <div className="space-y-5">
      <BulkHeader students={students} />
      {startError && <p className="text-xs text-warning-text">{startError}</p>}
      <SharedAnswers columns={form.folded} values={form.values} names={form.names} onReopen={form.reopen} total={start.total} />
      <MixedAnswers mixed={start.mixed} total={start.total} shown={form.sections.flatMap((s) => s.open.fields.map((f) => f.column))} />

      {form.sections.filter((s) => s.hasOpen).map(({ section, open }, i) => (
        <FormSectionBlock
          key={section.id}
          step={i + 1}
          section={open}
          values={form.values}
          previous={form.common}
          names={form.names}
          errors={form.errors}
          warnings={{}}
          onValue={form.setValue}
          onName={form.setName}
        />
      ))}

      <OverwriteToggle checked={form.overwrite} disabled={run.busy} onChange={form.setOverwrite} />

      {(run.stage === "preview" || run.stage === "saving") && (
        <PreviewSummary results={run.preview} warnings={run.warnings} accept={run.acceptWarnings} onAccept={run.setAcceptWarnings} />
      )}

      <BulkActions run={run} form={form} students={students.length} />
    </div>
  );
}

function BulkHeader({ students }: { students: BulkStudent[] }) {
  const newCount = students.filter((s) => s.kind === "pass-out").length;
  return (
    <>
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-coral-bg text-accent">
          <Users className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-xl font-extrabold text-text-primary">Edit {students.length} students together</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {newCount > 0 && `${newCount} not added yet — they get a new alumni record. `}
            {students.length - newCount > 0 && `${students.length - newCount} already added — their record is updated.`}
          </p>
        </div>
      </header>
      <p className="flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2 text-xs text-text-secondary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
        Fill in only what&apos;s the same for everyone. Blank answers leave each student&apos;s record as it is. Branches
        usually differ — leave Branch empty here and pick it per student in the table.
      </p>
    </>
  );
}

function OverwriteToggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm text-text-primary">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Also replace answers already on record
        <span className="block text-xs text-text-muted">Off: only blanks are filled — a different value a student already has is kept.</span>
      </span>
    </label>
  );
}

/** The sticky bar: progress while running, Save after a check, else Check. */
function BulkActions({ run, form, students }: {
  run: ReturnType<typeof useBulkRun>;
  form: ReturnType<typeof useBulkAnswers>;
  students: number;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-wrap items-center gap-3 rounded-b-xl border-t border-border bg-bg-card/95 px-6 py-4 backdrop-blur">
      <ActionsContent run={run} form={form} students={students} />
    </div>
  );
}

function ActionsContent({ run, form, students }: Parameters<typeof BulkActions>[0]) {
  if (run.busy) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {run.stage === "checking" ? "Checking" : "Saving"} {run.progress} of {run.total}…
      </span>
    );
  }
  if (run.stage === "preview") {
    return (
      <>
        <Button type="button" onClick={() => run.save(form)} disabled={!run.toSave.length}>
          Save {run.toSave.length} {run.toSave.length === 1 ? "student" : "students"}
        </Button>
        <Button type="button" variant="secondary" onClick={run.edited}>Change answers</Button>
      </>
    );
  }
  const errorCount = Object.keys(form.errors).length;
  const answerCount = Object.keys(form.answers).length;
  return (
    <>
      <Button type="button" onClick={() => run.check(form)} disabled={!answerCount || errorCount > 0}>
        Check {students} students
      </Button>
      <span className="text-sm text-text-muted">{checkHint(errorCount, answerCount)}</span>
    </>
  );
}

function checkHint(errorCount: number, answerCount: number): string {
  if (errorCount) return `${errorCount} field${errorCount === 1 ? " needs" : "s need"} fixing.`;
  return answerCount ? "Nothing is saved until you confirm." : "Fill in at least one answer.";
}

/** Answers every selected student already has: folded away, each with a pencil to change it. */
function SharedAnswers({ columns, values, names, total, onReopen }: {
  columns: string[];
  values: Values;
  names: Record<string, string>;
  total: number;
  onReopen: (column: string) => void;
}) {
  if (!columns.length) return null;
  return (
    <section className="rounded-xl border border-success/30 bg-success/5 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Already filled for all {total}
      </h3>
      <p className="mt-0.5 text-xs text-text-muted">Kept as each student has it. Use the pencil to set one answer for everyone.</p>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
        {columns.map((column) => (
          <li key={column} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-card px-2.5 py-1">
            <span className="text-text-muted">{LABEL.get(column)}:</span>
            <span className={values[column] ? "font-medium text-text-primary" : "italic text-text-muted"}>
              {names[column] || values[column] || "differs"}
            </span>
            <button type="button" aria-label={`Change ${LABEL.get(column)}`} onClick={() => onReopen(column)}
              className="rounded p-0.5 text-text-muted hover:bg-hover-bg hover:text-accent">
              <Pencil className="h-3 w-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Questions below that some students already answered: an answer here fills only the blanks. */
function MixedAnswers({ mixed, total, shown }: { mixed: Record<string, number>; total: number; shown: string[] }) {
  const columns = shown.filter((c) => mixed[c] && mixed[c] < total);
  if (!columns.length) return null;
  return (
    <p className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary">
      <span className="font-semibold text-text-primary">Some already answered</span> (an answer below fills only the
      blanks): {columns.map((c) => `${LABEL.get(c)} (${mixed[c]} of ${total})`).join(" · ")}
    </p>
  );
}

/** What a save would do, before anything is written. */
function PreviewSummary({ results, warnings, accept, onAccept }: {
  results: BulkResult[];
  warnings: ReturnType<typeof distinctWarnings>;
  accept: boolean;
  onAccept: (accept: boolean) => void;
}) {
  const problems = results.filter((r) => r.result === "error" || r.result === "denied");
  const keptCount = results.filter((r) => r.kept.length && (r.result === "create" || r.result === "update" || r.result === "unchanged")).length;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-bg-card-alt/40 p-4">
      <h3 className="text-sm font-bold text-text-primary">Check result — nothing saved yet</h3>
      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <Pill tone="coral" n={count(results, "create")} label="will be added (new record)" />
        <Pill tone="gold" n={count(results, "update")} label="will be updated" />
        <Pill tone="muted" n={count(results, "unchanged")} label="nothing to change" />
        <Pill tone="warning" n={count(results, "confirm")} label="need a confirm" />
        <Pill tone="danger" n={problems.length} label="can't be saved" />
      </div>
      {keptCount > 0 && (
        <p className="text-xs text-text-secondary">
          {keptCount} {keptCount === 1 ? "student keeps" : "students keep"} a different answer already on record for some fields
          (tick &quot;Also replace&quot; to change them).
        </p>
      )}
      {warnings.length > 0 && (
        <div className="space-y-2 rounded-lg border border-warning-border/30 bg-warning-bg p-3 text-sm">
          <p className="font-semibold text-text-primary">Unusual answers for {count(results, "confirm")} students:</p>
          <ul className="list-disc space-y-1 pl-5 text-text-primary">
            {warnings.map((w) => <li key={w.id}>{w.message}</li>)}
          </ul>
          <label className="flex items-center gap-2 font-medium text-text-primary">
            <input type="checkbox" checked={accept} onChange={(e) => onAccept(e.target.checked)} />
            They&apos;re correct — save these students too
          </label>
        </div>
      )}
      <ResultList results={problems} />
    </section>
  );
}

function Pill({ n, label, tone }: { n: number; label: string; tone: "coral" | "gold" | "muted" | "warning" | "danger" }) {
  if (!n) return null;
  const tones = {
    coral: "bg-brand-coral-bg text-brand-coral",
    gold: "bg-brand-gold-bg text-text-primary",
    muted: "bg-bg-card-alt text-text-muted",
    warning: "bg-warning-bg text-warning-text",
    danger: "bg-danger-bg text-danger",
  };
  return <span className={`rounded-full px-2.5 py-1 ${tones[tone]}`}>{n} {label}</span>;
}

/** Students that couldn't be saved, each with why. */
function ResultList({ results }: { results: BulkResult[] }) {
  if (!results.length) return null;
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
      {results.map((r) => (
        <li key={`${r.target.kind}-${r.target.id}`} className="flex items-start gap-1.5 text-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span><span className="font-semibold">{r.name || `#${r.target.id}`}</span> — {r.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** After the save: what was written, and what wasn't. */
function DoneView({ results, onClose }: { results: BulkResult[]; onClose: () => void }) {
  const failed = results.filter((r) => r.result !== "create" && r.result !== "update");
  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-xl font-extrabold text-text-primary">
        <CheckCircle2 className="h-6 w-6 text-success" aria-hidden /> Saved to the alumni table
      </h2>
      <div className="flex flex-wrap gap-2 text-sm font-medium">
        <Pill tone="coral" n={count(results, "create")} label="added (new record)" />
        <Pill tone="gold" n={count(results, "update")} label="updated" />
        <Pill tone="danger" n={failed.length} label="not saved" />
      </div>
      <ResultList results={failed} />
      <Button type="button" onClick={onClose}>Done</Button>
    </div>
  );
}
