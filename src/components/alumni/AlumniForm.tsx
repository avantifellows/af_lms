"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, BookOpen, Briefcase, CheckCircle2, ChevronDown, Compass, GraduationCap, Info, Loader2, Sparkles, X,
} from "lucide-react";
import { Badge, Button, Card, FormLabel, Input, Select } from "@/components/ui";
import Initials from "./Initials";
import ReferencePicker from "./ReferencePicker";
import {
  ALUMNI_SECTIONS, ENUMS, PROFILE_GROUPS, isFieldShown, isFieldStale,
  type FieldDef, type SectionDef, type Values,
} from "@/lib/alumni/fields";
import { needsConfirm, type Issue } from "@/lib/alumni/checks";
import { allowedDegrees, isDegreeCompatible } from "@/lib/alumni/compat";
import {
  MAX_YEAR, MIN_YEAR, checkContext, degreeMismatchMessage, reviewValues, visibleValues,
} from "@/lib/alumni/validation";

interface EntryContext {
  kind: "new" | "edit";
  ids: { enrollmentUserId: string; studentId: string; alumniId: string };
  name: string;
  afid: string;
  program: string;
  school: string;
  cohortYear: string;
  profile: Values;
  alumni: Values;
  codeNames: Record<string, string>;
}

interface SavedEntry {
  action: "inserted" | "updated";
  alumniId: string;
  changed: string[];
  notCleared: string[];
}

interface Props {
  userId: string;
  /** Called after a successful save (e.g. to refresh the student lists). */
  onSaved?: (userId: string) => void;
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  status: <Compass className="h-4 w-4" aria-hidden />,
  ug: <GraduationCap className="h-4 w-4" aria-hidden />,
  pg: <BookOpen className="h-4 w-4" aria-hidden />,
  work: <Briefcase className="h-4 w-4" aria-hidden />,
  more: <Sparkles className="h-4 w-4" aria-hidden />,
};

/** Statuses that mean the student took a gap year. */
const GAP_STATUS_FIELDS = ["ug_status", "current_status"];

/** Loads the student's form data; bumping `version` reloads it (after a save). */
function useEntry(userId: string, version: number) {
  const [context, setContext] = useState<EntryContext | null>(null);
  const [values, setValues] = useState<Values>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/alumni/student/${encodeURIComponent(userId)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error || "Couldn't load this student.");
        setContext(body);
        setValues(body.alumni ?? {});
        setNames(body.codeNames ?? {});
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load this student.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  return { context, values, setValues, names, setNames, loadError };
}

/** The same review the server runs, live — unusual answers show under their field while typing. */
function useReview(values: Values, context: EntryContext | null) {
  const review = useMemo(
    () => (context ? reviewValues(visibleValues(values), context.alumni, checkContext(context.profile)) : null),
    [values, context],
  );
  const warningsByField = useMemo(() => {
    const map: Record<string, Issue[]> = {};
    for (const w of review?.warnings ?? []) (map[w.field] ??= []).push(w);
    return map;
  }, [review]);
  return { review, warningsByField };
}

type SaveOutcome =
  | { kind: "saved"; entry: SavedEntry }
  | { kind: "confirm"; warnings: Issue[] }
  | { kind: "failed"; error: string; fieldErrors: Record<string, string> };

/** Sends the answers; the server re-checks everything and saves through the DB Service. */
async function postSave(userId: string, values: Values, confirmed: string[]): Promise<SaveOutcome> {
  try {
    const res = await fetch(`/api/alumni/student/${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, confirmed }),
    });
    const body = await res.json();
    if (res.status === 409 && body?.warnings) return { kind: "confirm", warnings: body.warnings };
    if (!res.ok) return { kind: "failed", error: body?.error || "Couldn't save. Try again.", fieldErrors: body?.fieldErrors ?? {} };
    return { kind: "saved", entry: body as SavedEntry };
  } catch {
    return { kind: "failed", error: "Couldn't save. Check your connection and try again.", fieldErrors: {} };
  }
}

function savedToast(name: string, entry: SavedEntry) {
  const fields = `${entry.changed.length} field${entry.changed.length === 1 ? "" : "s"} written.`;
  const kept = entry.notCleared.length ? `Kept on record (blank in form): ${entry.notCleared.join(", ")}.` : "";
  toast.success(`${entry.action === "inserted" ? "Added to" : "Updated in"} the alumni table — ${name || "student"}`, {
    description: [`alumni_id ${entry.alumniId} · ${fields}`, kept].filter(Boolean).join(" "),
    duration: 8000,
  });
}

/** Removes one key from a record, returning the same object when it wasn't there. */
const without = (record: Record<string, string>, key: string) => {
  if (!record[key]) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

export default function AlumniForm({ userId, onSaved }: Props) {
  /** Bumped after a save to reload the record from the database. */
  const [version, setVersion] = useState(0);
  const { context, values, setValues, names, setNames, loadError } = useEntry(userId, version);
  const { review, warningsByField } = useReview(values, context);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [formError, setFormError] = useState("");
  /** Unusual answers waiting for "yes, save anyway". */
  const [confirming, setConfirming] = useState<Issue[] | null>(null);

  const visibleSections = useMemo(
    () => ALUMNI_SECTIONS.filter((s) => s.fields.some((f) => isFieldShown(s, f, values))),
    [values],
  );

  if (loadError) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-danger-bg p-4 text-sm text-danger">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {loadError}
      </div>
    );
  }
  if (!context || !review) return <FormSkeleton />;

  const setValue = (column: string, value: string) => {
    // A Gap Year status means they took a gap year — fill that in for them.
    const autoGap = GAP_STATUS_FIELDS.includes(column) && value === "Gap Year" && !values.did_you_take_a_gap_year;
    setValues((prev) => ({ ...prev, [column]: value, ...(autoGap ? { did_you_take_a_gap_year: "Yes" } : {}) }));
    if (autoGap) toast.info('"Took a gap year?" set to Yes', { duration: 3000 });
    setErrors((prev) => without(prev, column));
    setDirty(true);
    setJustSaved(false);
    setFormError("");
  };

  const submit = async (confirmed: string[]) => {
    setSaving(true);
    setFormError("");
    const outcome = await postSave(userId, values, confirmed);
    setSaving(false);
    if (outcome.kind === "confirm") {
      setConfirming(outcome.warnings);
      return;
    }
    if (outcome.kind === "failed") {
      setErrors(outcome.fieldErrors);
      setFormError(outcome.error);
      return;
    }
    setConfirming(null);
    setDirty(false);
    setJustSaved(true);
    setVersion((v) => v + 1); // reload what's now in the database
    onSaved?.(userId);
    savedToast(context.name, outcome.entry);
  };

  const save = () => {
    // Same review the server runs — catch problems without a round trip.
    setErrors(review.errors);
    setFormError("");
    const firstError = Object.keys(review.errors)[0];
    if (firstError) {
      document.getElementById(`f-${firstError}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return;
    }
    const toConfirm = needsConfirm(review.warnings);
    if (toConfirm.length) setConfirming(toConfirm);
    else submit([]);
  };

  return (
    <div className="space-y-5">
      <FormHeader context={context} />

      {context.kind === "edit" && (
        <p className="flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2 text-xs text-text-secondary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
          Saving writes only the fields you fill in or change. Leaving a field blank never erases what&apos;s on record.
        </p>
      )}

      <ProfileSummary profile={context.profile} />

      {visibleSections.map((section, i) => (
        <FormSectionBlock
          key={section.id}
          step={i + 1}
          section={section}
          values={values}
          previous={context.alumni}
          names={names}
          errors={errors}
          warnings={warningsByField}
          onValue={setValue}
          onName={(column, name) => setNames((prev) => ({ ...prev, [column]: name }))}
        />
      ))}

      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-wrap items-center gap-3 rounded-b-xl border-t border-border bg-bg-card/95 px-6 py-4 backdrop-blur">
        <Button type="button" onClick={save} disabled={saving} className="min-w-[140px]">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
            </>
          ) : context.kind === "edit" ? "Save changes" : "Save"}
        </Button>
        <SaveStatus
          errorCount={Object.keys(errors).length}
          formError={formError}
          dirty={dirty}
          justSaved={justSaved}
          pendingWarnings={needsConfirm(review.warnings).length}
        />
      </div>

      {confirming && (
        <ConfirmDialog
          issues={confirming}
          saving={saving}
          onCancel={() => setConfirming(null)}
          onConfirm={() => submit(confirming.map((w) => w.id))}
        />
      )}
    </div>
  );
}

function FormHeader({ context }: { context: EntryContext }) {
  return (
    <header className="flex flex-wrap items-start gap-4">
      <Initials name={context.name || "?"} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-extrabold text-text-primary">{context.name || "(no name)"}</h2>
          <Badge variant={context.kind === "new" ? "danger" : "default"}>
            {context.kind === "new" ? "New alumni entry" : "Edit alumni record"}
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-text-secondary">
          {[context.program, context.school].filter(Boolean).join(" · ")}
          {context.cohortYear && ` · cohort ${context.cohortYear}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]">
          <IdChip label="AFID" value={context.afid} />
          <IdChip label="enrollment_user_id" value={context.ids.enrollmentUserId} />
          <IdChip label="student.id" value={context.ids.studentId} />
          {context.kind === "edit" && <IdChip label="alumni_id" value={context.ids.alumniId} />}
        </div>
      </div>
    </header>
  );
}

/** One line next to Save: what needs fixing, what's unsaved, or that it saved. */
function SaveStatus({
  errorCount, formError, dirty, justSaved, pendingWarnings,
}: { errorCount: number; formError: string; dirty: boolean; justSaved: boolean; pendingWarnings: number }) {
  if (errorCount > 0) {
    return (
      <span className="flex items-center gap-1 text-sm text-danger">
        <AlertTriangle className="h-4 w-4" aria-hidden /> {errorCount} field{errorCount === 1 ? "" : "s"} need fixing.
      </span>
    );
  }
  if (formError) return <span className="text-sm text-danger">{formError}</span>;
  if (dirty) {
    return (
      <span className="text-sm text-text-muted">
        Unsaved changes{pendingWarnings > 0 && ` · ${pendingWarnings} answer${pendingWarnings === 1 ? "" : "s"} to confirm`}
      </span>
    );
  }
  if (!justSaved) return null;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
      <CheckCircle2 className="h-4 w-4" aria-hidden /> Saved to the alumni table
    </span>
  );
}

function IdChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md bg-bg-card-alt px-1.5 py-0.5 text-text-muted">
      {label} <span className="font-semibold text-text-primary">{value || "—"}</span>
    </span>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading student">
      <div className="flex items-center gap-4">
        <div className="animate-pulse rounded-full bg-bg-card-alt h-12 w-12 " />
        <div className="flex-1 space-y-2">
          <div className="animate-pulse rounded-lg bg-bg-card-alt h-5 w-1/3" />
          <div className="animate-pulse rounded-lg bg-bg-card-alt h-3 w-1/2" />
        </div>
      </div>
      <div className="animate-pulse rounded-lg bg-bg-card-alt h-10 w-full" />
      <div className="animate-pulse rounded-lg bg-bg-card-alt h-48 w-full" />
    </div>
  );
}

/** "These answers look unusual — save anyway?" Each one is listed with its reason. */
function ConfirmDialog({ issues, saving, onCancel, onConfirm }: { issues: Issue[]; saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <Card
        elevation="xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-bg text-warning-text">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="confirm-title" className="text-lg font-extrabold text-text-primary">
              {issues.length === 1 ? "This answer looks unusual" : `${issues.length} answers look unusual`}
            </h3>
            <p className="mt-0.5 text-sm text-text-secondary">They&apos;re possible, so you can still save — please check them first.</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded p-1 text-text-muted hover:bg-hover-bg" aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {issues.map((w) => (
            <li key={w.id} className="rounded-lg border border-warning-border/30 bg-warning-bg px-3 py-2 text-sm text-text-primary">
              {w.message}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Go back and fix</Button>
          <Button ref={confirmRef} type="button" onClick={onConfirm} disabled={saving}>
            {saving ? "Saving…" : "Yes, it's correct — save"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ProfileSummary({ profile }: { profile: Values }) {
  return (
    <details className="group rounded-xl border border-border bg-bg-card-alt/40">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-text-primary">
        <span>Profile <span className="font-normal text-text-muted">· from LMS, read-only</span></span>
        <ChevronDown className="h-4 w-4 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-3">
        {PROFILE_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-text-muted">{group.title}</p>
            <dl className="space-y-1 text-xs">
              {group.fields.map(([column, label]) => (
                <div key={column}>
                  <dt className="text-text-muted">{label}</dt>
                  <dd className={profile[column] ? "text-text-primary" : "text-text-muted/60"}>{profile[column] || "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}

interface SectionProps {
  step: number;
  section: SectionDef;
  values: Values;
  /** Values on record when the form opened. */
  previous: Values;
  names: Record<string, string>;
  errors: Record<string, string>;
  warnings: Record<string, Issue[]>;
  onValue: (column: string, value: string) => void;
  onName: (column: string, name: string) => void;
}

function FormSectionBlock({ step, section, values, previous, names, errors, warnings, onValue, onName }: SectionProps) {
  const fields = section.fields.filter((f) => isFieldShown(section, f, values));
  const body = (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.column] ?? "";
        const degree = degreeInfo(field.column, value, values, previous, names);
        return (
          <FieldControl
            key={field.column}
            field={field}
            value={value}
            name={names[field.column] ?? ""}
            error={errors[field.column] ?? degree?.mismatch}
            warnings={warnings[field.column]}
            hint={degree?.hint}
            options={degree?.options}
            stale={isFieldStale(section, field, values)}
            onRecord={!!value && value === (previous[field.column] ?? "")}
            onValue={(v) => onValue(field.column, v)}
            onName={(n) => onName(field.column, n)}
          />
        );
      })}
    </div>
  );

  const heading = (
    <span className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-coral-bg text-accent">{SECTION_ICONS[section.id]}</span>
      <span className="text-[15px] font-bold text-text-primary">{section.title}</span>
      <span className="text-xs font-semibold text-text-muted">Step {step}</span>
    </span>
  );

  if (section.collapsed) {
    const hasValue = fields.some((f) => values[f.column]);
    return (
      <details className="group rounded-xl border border-border" open={hasValue}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          {heading}
          <ChevronDown className="h-4 w-4 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-border p-4">{body}</div>
      </details>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-bg-card p-4 shadow-sm sm:p-5">
      {heading}
      {section.description && <p className="mt-1.5 text-xs text-text-muted">{section.description}</p>}
      <div className="mt-4">{body}</div>
    </section>
  );
}

/** For a degree field: the options that fit the chosen branch, and a live mismatch message. */
function degreeInfo(column: string, value: string, values: Values, previous: Values, names: Record<string, string>) {
  if (column !== "degree_ug" && column !== "degree_pg") return null;
  const level = column === "degree_ug" ? "ug" : "pg";
  const branchColumn = `branch_id_${level}`;
  const branch = values[branchColumn] ?? "";
  const allowed = allowedDegrees(level, branch);
  if (!allowed) return null;
  const options = (ENUMS[column] ?? []).filter((d) => allowed.includes(d));
  const hint = `Showing degrees that fit ${names[branchColumn] || branch}.`;
  if (isDegreeCompatible(level, branch, value)) return { options, hint };
  // A mismatched pair already on record may stay (validation allows it) — note it, don't block.
  const onRecord = branch === (previous[branchColumn] ?? "") && value === (previous[column] ?? "");
  return onRecord
    ? { options, hint: "The degree on record doesn't fit this branch — fix it if you know the right one." }
    : { options, hint, mismatch: degreeMismatchMessage(level, branch) };
}

interface FieldProps {
  field: FieldDef;
  value: string;
  name: string;
  error?: string;
  /** Unusual answers to show under this field. */
  warnings?: Issue[];
  hint?: string;
  /** Overrides the field's full option list (e.g. degrees filtered by branch). */
  options?: readonly string[];
  stale: boolean;
  /** The value is what's already saved in the database. */
  onRecord: boolean;
  onValue: (value: string) => void;
  onName: (name: string) => void;
}

function FieldControl(props: FieldProps) {
  const { field, error, warnings } = props;
  const id = `f-${field.column}`;
  const wide = field.type === "college" || field.type === "branch" || field.label.length > 40;
  const live = (warnings ?? []).filter((w) => !w.onRecord);
  const noted = (warnings ?? []).filter((w) => w.onRecord);
  const ring = error ? "rounded-lg ring-2 ring-danger" : live.length ? "rounded-lg ring-2 ring-warning-border/50" : "";

  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <FormLabel htmlFor={id}>{field.label}</FormLabel>
      <div className={ring}>
        <FieldInput {...props} id={id} />
      </div>
      <FieldNotes {...props} live={live} noted={noted} />
    </div>
  );
}

/** The control itself: college/branch search, a dropdown, or a text/number box. */
function FieldInput({ field, id, value, name, error, options, onValue, onName }: FieldProps & { id: string }) {
  if (field.type === "college" || field.type === "branch") {
    return (
      <ReferencePicker
        kind={field.type}
        id={id}
        code={value}
        name={name}
        onChange={(code, newName) => {
          onValue(code);
          onName(newName);
        }}
      />
    );
  }
  if (field.type === "enum") {
    return <EnumSelect column={field.column} id={id} value={value} error={error} options={options} onValue={onValue} />;
  }
  const numeric = field.type === "year" || field.type === "number";
  const isYear = field.type === "year";
  return (
    <Input
      id={id}
      type={numeric ? "number" : "text"}
      inputMode={numeric ? "numeric" : undefined}
      min={isYear ? MIN_YEAR : numeric ? 0 : undefined}
      max={isYear ? MAX_YEAR : undefined}
      step={isYear ? 1 : undefined}
      placeholder={isYear ? "e.g. 2025" : undefined}
      value={value}
      onChange={(e) => onValue(e.target.value)}
      aria-invalid={!!error}
    />
  );
}

/** A dropdown; a value on record that isn't in the list stays selectable, labelled why. */
function EnumSelect({
  column, id, value, error, options, onValue,
}: { column: string; id: string; value: string; error?: string; options?: readonly string[]; onValue: (v: string) => void }) {
  const all = ENUMS[column] ?? [];
  const list = options ?? all;
  const offListLabel = all.includes(value) ? "doesn't fit the branch" : "current value, not in list";
  return (
    <Select id={id} value={value} onChange={(e) => onValue(e.target.value)} aria-invalid={!!error}>
      <option value="">—</option>
      {list.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
      {value && !list.includes(value) && <option value={value}>{value} ({offListLabel})</option>}
    </Select>
  );
}

/** Messages under a field: its error, unusual-answer warnings, notes on old records, a hint, or a stale value. */
function FieldNotes({
  error, hint, stale, onRecord, onValue, onName, live, noted,
}: FieldProps & { live: Issue[]; noted: Issue[] }) {
  return (
    <>
      {error && (
        <p className="mt-1.5 flex items-start gap-1 text-xs text-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden /> {error}
        </p>
      )}
      {!error && live.map((w) => (
        <p key={w.id} className="mt-1.5 flex items-start gap-1 text-xs text-warning-text">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden /> {w.message} You&apos;ll be asked to confirm.
        </p>
      ))}
      {!error && noted.map((w) => (
        <p key={w.id} className="mt-1.5 flex items-start gap-1 text-xs text-text-muted">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden /> On record: {w.message}
        </p>
      ))}
      {!error && !live.length && hint && <p className="mt-1.5 text-xs text-text-muted">{hint}</p>}
      {stale && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-warning-text">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          {onRecord ? (
            <>Doesn&apos;t match the answers above. It stays on record — saving never erases a saved value.</>
          ) : (
            <>
              Doesn&apos;t match the answers above.
              <button type="button" className="font-bold underline" onClick={() => { onValue(""); onName(""); }}>
                Clear
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}
