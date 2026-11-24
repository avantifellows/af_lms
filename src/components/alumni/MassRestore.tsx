"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, History, Loader2, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import {
  RESTORE_CHUNK,
  type HistoryGroup,
  type RestorePlan,
  type RestoreResult,
  type RestoreScope,
} from "@/lib/alumni/mass-restore-types";
import { SOURCES, formatMoment, useMakeRoom } from "./AlumniHistory";

// Version history for many alumni (all of them on the Alumni page, one
// school's on its page), like a sheet's: a panel on the right lists the steps
// — a bulk edit, a run of calls, a restore — newest first. Picking one shows
// exactly who would go back to how they were just before it, and how; that
// can then be restored. Each restore is a "Correction" in the alumnus's own
// history, so it can be undone the same way.

type Step =
  | { kind: "list" }
  | { kind: "plan"; group: HistoryGroup; plan: RestorePlan }
  | { kind: "running"; group: HistoryGroup; plan: RestorePlan; done: number }
  | { kind: "done"; group: HistoryGroup; results: RestoreResult[] };

type Load = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; groups: HistoryGroup[] };

/** Just before the step: restoring to it undoes the step and everything after (seconds are the finest the rows keep). */
const justBefore = (group: HistoryGroup) => new Date(Date.parse(group.start) - 1000).toISOString();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function send(body: object): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/alumni/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return r.ok ? { ok: true, data } : { ok: false, error: data.error ?? "Something went wrong." };
  } catch {
    return { ok: false, error: "Check your connection and try again." };
  }
}

/** The scope's steps; loaded again whenever `reloadKey` changes (loading until this load's answer is in). */
function useHistory(scope: RestoreScope, open: boolean, reloadKey: number): Load {
  const [answer, setAnswer] = useState<{ token: string; load: Load } | null>(null);
  const key = JSON.stringify(scope);
  const token = `${key}#${reloadKey}`;
  useEffect(() => {
    if (!open) return;
    let live = true;
    send({ scope: JSON.parse(key), history: true }).then((r) => {
      if (!live) return;
      const load: Load = r.ok ? { kind: "ready", groups: r.data.groups as HistoryGroup[] } : { kind: "error", error: r.error };
      setAnswer({ token, load });
    });
    return () => {
      live = false;
    };
  }, [key, token, open]);
  return answer?.token === token ? answer.load : { kind: "loading" };
}

export default function MassRestore({ scope, scopeLabel }: { scope: RestoreScope; scopeLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const history = useHistory(scope, open, reloadKey);
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const close = () => {
    if (step.kind === "running") return;
    setOpen(false);
    setStep({ kind: "list" });
    setError("");
  };

  const pick = async (group: HistoryGroup) => {
    setBusyId(group.id);
    setError("");
    const r = await send({ scope, at: justBefore(group), dryRun: true });
    setBusyId(null);
    if (!r.ok) return setError(r.error);
    setStep({ kind: "plan", group, plan: r.data as unknown as RestorePlan });
  };

  const restore = async (group: HistoryGroup, plan: RestorePlan) => {
    const at = justBefore(group);
    const ids = plan.items.map((i) => i.alumniId);
    const results: RestoreResult[] = [];
    setStep({ kind: "running", group, plan, done: 0 });
    for (let i = 0; i < ids.length; i += RESTORE_CHUNK) {
      const chunk = ids.slice(i, i + RESTORE_CHUNK);
      const r = await send({ scope, at, alumniIds: chunk });
      if (r.ok) results.push(...(r.data.results as RestoreResult[]));
      else results.push(...chunk.map((alumniId) => failed(alumniId, plan, r.error)));
      setStep({ kind: "running", group, plan, done: Math.min(i + RESTORE_CHUNK, ids.length) });
    }
    setStep({ kind: "done", group, results });
    setReloadKey((k) => k + 1);
    router.refresh();
  };

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <History className="h-4 w-4" aria-hidden /> History
      </Button>
      {open && (
        <Panel title={`Version history · ${scopeLabel}`} onClose={step.kind === "running" ? undefined : close}>
          {step.kind === "list" && <GroupList load={history} busyId={busyId} error={error} onPick={pick} />}
          {step.kind === "plan" && (
            <PlanView
              group={step.group}
              plan={step.plan}
              onBack={() => setStep({ kind: "list" })}
              onRestore={() => restore(step.group, step.plan)}
            />
          )}
          {step.kind === "running" && <Progress done={step.done} total={step.plan.items.length} />}
          {step.kind === "done" && (
            <DoneView group={step.group} results={step.results} onBack={() => setStep({ kind: "list" })} />
          )}
        </Panel>
      )}
    </>
  );
}

const failed = (alumniId: string, plan: RestorePlan, message: string): RestoreResult => ({
  alumniId,
  name: plan.items.find((p) => p.alumniId === alumniId)?.name ?? "",
  result: "error",
  message,
  changed: [],
});

/** The panel on the right (full screen on a phone); the page makes room for it. */
function Panel({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
  useMakeRoom("32rem");
  return (
    <aside
      role="dialog"
      aria-label={title}
      className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-border bg-bg-card shadow-2xl sm:max-w-lg"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <History className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <h2 className="truncate font-bold text-text-primary">{title}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close version history"
            className="ml-auto rounded-md p-1.5 text-text-muted hover:bg-hover-bg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
    </aside>
  );
}

function GroupList({ load, busyId, error, onPick }: {
  load: Load;
  busyId: string | null;
  error: string;
  onPick: (group: HistoryGroup) => void;
}) {
  if (load.kind === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading history…
      </p>
    );
  }
  if (load.kind === "error") return <p className="text-sm text-danger">{load.error}</p>;
  if (!load.groups.length) return <p className="text-sm text-text-muted">No changes yet. History starts with the next save.</p>;
  return (
    <>
      <p className="text-xs text-text-muted">
        Pick a change to see who would go back to how they were just before it. Nothing changes until you restore.
      </p>
      {error && (
        <p className="flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
      <ol className="space-y-1.5">
        {load.groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              onClick={() => onPick(group)}
              disabled={busyId !== null}
              className="w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-bg-card-alt disabled:opacity-60"
            >
              <GroupSummary group={group} />
              {busyId === group.id && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking…
                </p>
              )}
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function GroupSummary({ group }: { group: HistoryGroup }) {
  const source = SOURCES[group.source] ?? SOURCES.form;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-semibold text-text-primary">{formatMoment(group.start)}</span>
        <Badge variant={source.variant}>{source.label}</Badge>
        <span className="text-xs font-semibold text-text-secondary">{plural(group.alumni, "alumnus", "alumni")}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-text-muted">{group.by || "—"}</p>
      {group.note && <p className="mt-1 text-xs text-text-secondary">“{group.note}”</p>}
    </>
  );
}

function PlanView({ group, plan, onBack, onRestore }: {
  group: HistoryGroup;
  plan: RestorePlan;
  onBack: () => void;
  onRestore: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const n = plan.items.length;
  return (
    <>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to history
      </button>
      <div className="rounded-lg bg-bg-card-alt px-3 py-2.5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Undo this and everything after it</p>
        <GroupSummary group={group} />
      </div>
      <p className="text-sm text-text-primary">
        {n ? (
          <><strong>{plural(n, "alumnus", "alumni")}</strong> would go back to how they were just before this.</>
        ) : (
          <>Everyone is already as they were just before this: there is nothing to restore.</>
        )}
      </p>
      {plan.addedAfter.length > 0 && (
        <p className="rounded-md bg-info-bg px-3 py-2 text-xs text-text-secondary">
          {plural(plan.addedAfter.length, "alumnus was", "alumni were")} added since and stay as they are (records are never removed):{" "}
          {plan.addedAfter.slice(0, 5).map((a) => a.name).join(", ")}
          {plan.addedAfter.length > 5 && ` and ${plan.addedAfter.length - 5} more`}.
        </p>
      )}
      {n > 0 && <PlanItems plan={plan} />}
      {n > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          {confirming ? (
            <>
              <span className="mr-auto text-sm text-warning-text">Restore {plural(n, "alumnus", "alumni")}? Newer versions stay in history.</span>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button type="button" onClick={onRestore}>Yes, restore</Button>
            </>
          ) : (
            <Button type="button" onClick={() => setConfirming(true)}>Restore {plural(n, "alumnus", "alumni")}</Button>
          )}
        </div>
      )}
    </>
  );
}

function PlanItems({ plan }: { plan: RestorePlan }) {
  return (
    <ul className="space-y-2">
      {plan.items.map((item) => (
        <li key={item.alumniId} className="rounded-md bg-bg-card-alt px-3 py-2">
          <p className="text-sm font-semibold text-text-primary">
            {item.name}
            {item.school && <span className="font-normal text-text-muted"> · {item.school}</span>}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {item.changes.map((c) => (
              <li key={c.label} className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-text-secondary">{c.label}:</span>
                <span className="text-text-muted line-through">{c.before || "blank"}</span>
                <ArrowRight className="h-3 w-3 text-text-muted" aria-hidden />
                <span className="font-semibold text-blue-700">{c.after || "blank"}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-text-primary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Restoring… {done} of {total}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-card-alt">
        <div className="h-full bg-accent transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-text-muted">Keep this panel open until it finishes.</p>
    </div>
  );
}

function DoneView({ group, results, onBack }: { group: HistoryGroup; results: RestoreResult[]; onBack: () => void }) {
  const restored = results.filter((r) => r.result === "restored").length;
  const errors = results.filter((r) => r.result === "error");
  const unchanged = results.length - restored - errors.length;
  return (
    <>
      <p className="flex items-start gap-2 text-sm text-text-primary">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden />
        <span>
          Restored <strong>{plural(restored, "alumnus", "alumni")}</strong> to just before {formatMoment(group.start)}.
          {unchanged > 0 && ` ${unchanged} already matched and were left as they are.`}
        </span>
      </p>
      {errors.length > 0 && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          <p className="font-semibold">{errors.length} couldn&apos;t be restored — try them again:</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {errors.map((f) => <li key={f.alumniId}>{f.name || `alumni ${f.alumniId}`}: {f.message}</li>)}
          </ul>
        </div>
      )}
      <Button type="button" variant="secondary" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to history
      </Button>
    </>
  );
}
