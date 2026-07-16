"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import GuidanceEditor from "./GuidanceEditor";

type Question = { id?: number; text: string };
type Phase = {
  id: number;
  number: number;
  grade: 11 | 12;
  title: string;
  state: "locked" | "open";
  guidanceMarkdown: string;
  revision: number;
  frozen: boolean;
  everOpened: boolean;
  used: boolean;
  active: boolean;
  questions: Question[];
};
type Plan = { id: number; academicYear: string; editable: boolean; phases: Phase[] };
type Draft = { id?: number; revision?: number; grade: 11 | 12; title: string; guidanceMarkdown: string; questions: Question[]; everOpened?: boolean };

const [start] = CURRENT_ACADEMIC_YEAR.split("-").map(Number);
const PRIOR_ACADEMIC_YEAR = `${start - 1}-${start}`;
const emptyDraft = (): Draft => ({ grade: 11, title: "", guidanceMarkdown: "", questions: [{ text: "" }] });

export default function PhasePlanSetup() {
  const [academicYear, setAcademicYear] = useState(CURRENT_ACADEMIC_YEAR);
  const [plan, setPlan] = useState<Plan | null | undefined>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedPhase = draft?.id ? plan?.phases.find((phase) => phase.id === draft.id) : undefined;
  const definitionReadOnly = !plan?.editable || !!selectedPhase?.frozen || !!selectedPhase?.used;

  const load = useCallback(async (year = academicYear) => {
    setPlan(undefined);
    setDraft(null);
    setMessage("");
    try {
      const result = await fetch(`/api/holistic-mentorship/phase-plans?academic_year=${year}`);
      const data = await result.json();
      if (!result.ok) setMessage(data.error ?? "Could not load the Plan");
      setPlan(data.plan ?? null);
    } catch {
      setMessage("Could not load the Plan");
      setPlan(null);
    }
  }, [academicYear]);

  useEffect(() => { void load(); }, [load]);

  async function request(method: string, payload: Record<string, unknown>, reload = true) {
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/holistic-mentorship/phase-plans", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await result.json();
      if (!result.ok) {
        setMessage(result.status === 409
          ? `${data.error}. Reload to review revision ${data.currentRevision ?? "latest"}; your unsaved text is preserved.`
          : data.error ?? "Could not save the Plan");
        return false;
      }
      if (reload) await load();
      return true;
    } catch {
      setMessage("Could not save the Plan");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(copy: boolean) {
    await request("POST", {
      action: "create",
      academic_year: CURRENT_ACADEMIC_YEAR,
      ...(copy ? { copy_from_academic_year: PRIOR_ACADEMIC_YEAR } : {}),
    });
  }

  function edit(phase: Phase) {
    setDraft({
      id: phase.id,
      revision: phase.revision,
      grade: phase.grade,
      title: phase.title,
      guidanceMarkdown: phase.guidanceMarkdown,
      questions: phase.questions.map((question) => ({ ...question })),
      everOpened: phase.everOpened,
    });
    setMessage("");
  }

  async function save() {
    if (!draft) return;
    const phase = draft.id ? plan?.phases.find((item) => item.id === draft.id) : null;
    const confirmed = !!phase?.everOpened && window.confirm("Save confirmed Guidance changes to this previously opened Phase?");
    if (phase?.everOpened && !confirmed) return;
    const payload = {
      grade: draft.grade,
      title: draft.title,
      guidance_markdown: draft.guidanceMarkdown,
      questions: draft.questions,
    };
    const saved = draft.id
      ? await request("PATCH", { action: "update", phase_id: draft.id, expected_revision: draft.revision, confirmed, ...payload }, false)
      : await request("POST", { action: "add", academic_year: academicYear, ...payload }, false);
    if (saved) await load();
  }

  async function changeState(phase: Phase) {
    const next = phase.state === "locked" ? "open" : "locked";
    if (!window.confirm(`${next === "open" ? "Open" : "Return to Locked"} Phase ${phase.number}?`)) return;
    await request("PATCH", { action: "state", phase_id: phase.id, expected_revision: phase.revision, state: next, confirmed: true });
  }

  async function remove(phase: Phase) {
    if (!window.confirm(`Delete Phase ${phase.number}?`)) return;
    await request("DELETE", { phase_id: phase.id, expected_revision: phase.revision });
  }

  async function move(index: number, offset: -1 | 1) {
    if (!plan) return;
    const reordered = [...plan.phases];
    [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
    await request("PATCH", {
      action: "reorder",
      academic_year: academicYear,
      phases: reordered.map((phase) => ({ id: phase.id, expected_revision: phase.revision })),
    });
  }

  if (plan === undefined) return <p className="py-12 text-center text-sm text-text-muted">Loading Phase Plan...</p>;

  return (
    <section className="space-y-5" aria-label="Phase Setup">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <label className="w-48 text-sm font-medium text-text-primary">
          Academic Year
          <Select value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} className="mt-1">
            <option value={CURRENT_ACADEMIC_YEAR}>{CURRENT_ACADEMIC_YEAR}</option>
            <option value={PRIOR_ACADEMIC_YEAR}>{PRIOR_ACADEMIC_YEAR}</option>
          </Select>
        </label>
        {plan?.editable && (
          <Button type="button" onClick={() => setDraft(emptyDraft())} disabled={busy}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add Phase
          </Button>
        )}
      </div>

      {message && <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{message}</p>}

      {!plan ? (
        academicYear === CURRENT_ACADEMIC_YEAR ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 border border-dashed border-border p-6 text-center">
            <p className="text-sm text-text-secondary">No Plan exists for {CURRENT_ACADEMIC_YEAR}.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => create(false)} disabled={busy}>Create blank Plan</Button>
              <Button type="button" variant="secondary" onClick={() => create(true)} disabled={busy}>Copy {PRIOR_ACADEMIC_YEAR} Plan</Button>
            </div>
          </div>
        ) : <p className="py-12 text-center text-sm text-text-muted">No prior-year Plan.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(24rem,1.4fr)]">
          <div className="divide-y divide-border border-y border-border">
            {plan.phases.length === 0 && <p className="py-10 text-center text-sm text-text-muted">No Phases configured.</p>}
            {plan.phases.map((phase, index) => {
              const mutable = plan.editable && phase.state === "locked" && !phase.everOpened && !phase.used && !phase.frozen;
              const previous = plan.phases[index - 1];
              const next = plan.phases[index + 1];
              const canMoveUp = mutable && !!previous && previous.state === "locked" && !previous.everOpened && !previous.used && !previous.frozen;
              const canMoveDown = mutable && !!next && next.state === "locked" && !next.everOpened && !next.used && !next.frozen;
              return (
                <div key={phase.id} className={`flex gap-3 px-2 py-3 ${draft?.id === phase.id ? "bg-selected-bg" : ""}`}>
                  <button type="button" onClick={() => edit(phase)} className="min-w-0 flex-1 text-left">
                    <span className="text-xs font-semibold text-text-muted">Phase {phase.number} · Grade {phase.grade}</span>
                    <span className="block truncate text-sm font-semibold text-text-primary">{phase.title}</span>
                    <span className="text-xs text-text-secondary">{phase.state === "open" ? "Open" : "Locked"}{phase.active ? " · Active" : ""}</span>
                  </button>
                  {plan.editable && (
                    <div className="flex shrink-0 items-center">
                      <Button type="button" variant="icon" size="sm" title="Move up" aria-label={`Move Phase ${phase.number} up`} disabled={!canMoveUp || busy} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button type="button" variant="icon" size="sm" title="Move down" aria-label={`Move Phase ${phase.number} down`} disabled={!canMoveDown || busy} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button type="button" variant="icon" size="sm" title="Delete" aria-label={`Delete Phase ${phase.number}`} disabled={!mutable || busy} onClick={() => remove(phase)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <label className="text-sm font-medium text-text-primary">Grade
                  <Select className="mt-1" value={draft.grade} disabled={!plan.editable || draft.everOpened} onChange={(event) => setDraft({ ...draft, grade: Number(event.target.value) as 11 | 12 })}>
                    <option value={11}>11</option><option value={12}>12</option>
                  </Select>
                </label>
                <label className="text-sm font-medium text-text-primary">Title
                  <Input className="mt-1" maxLength={120} value={draft.title} disabled={!plan.editable || draft.everOpened} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                </label>
              </div>
              <GuidanceEditor value={draft.guidanceMarkdown} readOnly={definitionReadOnly} onChange={(guidanceMarkdown) => setDraft({ ...draft, guidanceMarkdown })} />
              <fieldset className="space-y-2" disabled={!plan.editable || draft.everOpened}>
                <legend className="text-sm font-semibold text-text-primary">Questions</legend>
                {draft.questions.map((question, index) => (
                  <div key={question.id ?? index} className="flex gap-2">
                    <Input aria-label={`Question ${index + 1}`} value={question.text} onChange={(event) => setDraft({ ...draft, questions: draft.questions.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} />
                    <Button type="button" variant="icon" title="Remove Question" aria-label={`Remove Question ${index + 1}`} disabled={draft.questions.length === 1} onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" disabled={draft.questions.length === 4} onClick={() => setDraft({ ...draft, questions: [...draft.questions, { text: "" }] })}><Plus className="h-4 w-4" /> Add Question</Button>
              </fieldset>
              {plan.editable && (
                <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
                  <div>{draft.id && <Button type="button" variant="secondary" onClick={() => changeState(plan.phases.find((phase) => phase.id === draft.id)!)} disabled={busy || !!selectedPhase?.frozen || !!selectedPhase?.used}>{plan.phases.find((phase) => phase.id === draft.id)?.state === "open" ? "Return to Locked" : "Open Phase"}</Button>}</div>
                  <Button type="button" onClick={save} disabled={busy || definitionReadOnly}>Save Phase</Button>
                </div>
              )}
            </div>
          ) : <p className="py-12 text-center text-sm text-text-muted">Select a Phase or add one.</p>}
        </div>
      )}
    </section>
  );
}
