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

function phaseIsMutable(phase: Phase | undefined, editable: boolean) {
  return !!phase && editable && phase.state === "locked" && !phase.everOpened && !phase.used && !phase.frozen;
}

function draftPayload(draft: Draft) {
  return {
    grade: draft.grade,
    title: draft.title,
    guidance_markdown: draft.guidanceMarkdown,
    questions: draft.questions,
  };
}

async function persistDraft(
  draft: Draft,
  academicYear: string,
  confirmed: boolean,
  request: (method: string, payload: Record<string, unknown>, reload?: boolean) => Promise<boolean>
) {
  if (draft.id) {
    return request("PATCH", {
      action: "update",
      phase_id: draft.id,
      expected_revision: draft.revision,
      confirmed,
      ...draftPayload(draft),
    }, false);
  }
  return request("POST", { action: "add", academic_year: academicYear, ...draftPayload(draft) }, false);
}

function confirmPreviouslyOpenedPhase(phase: Phase | null | undefined) {
  if (!phase?.everOpened) return true;
  return window.confirm("Save confirmed Guidance changes to this previously opened Phase?");
}

function selectedDraftPhase(plan: Plan | null | undefined, draft: Draft | null) {
  if (!draft?.id) return undefined;
  return plan?.phases.find((phase) => phase.id === draft.id);
}

function isDefinitionReadOnly(plan: Plan | null | undefined, selectedPhase: Phase | undefined) {
  if (!plan?.editable) return true;
  return !!selectedPhase && (selectedPhase.frozen || selectedPhase.used);
}

export default function PhasePlanSetup() {
  const [academicYear, setAcademicYear] = useState(CURRENT_ACADEMIC_YEAR);
  const [plan, setPlan] = useState<Plan | null | undefined>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedPhase = selectedDraftPhase(plan, draft);
  const definitionReadOnly = isDefinitionReadOnly(plan, selectedPhase);

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
    if (!confirmPreviouslyOpenedPhase(phase)) return;
    const saved = await persistDraft(draft, academicYear, !!phase?.everOpened, request);
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
      <PlanToolbar academicYear={academicYear} editable={!!plan?.editable} busy={busy}
        onAcademicYearChange={setAcademicYear} onAdd={() => setDraft(emptyDraft())} />
      {message && <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{message}</p>}
      <PlanContent plan={plan} academicYear={academicYear} draft={draft} selectedPhase={selectedPhase}
        definitionReadOnly={definitionReadOnly} busy={busy} onCreate={create} onEdit={edit} onMove={move}
        onRemove={remove} onDraftChange={setDraft} onChangeState={changeState} onSave={save} />
    </section>
  );
}

function PlanToolbar({ academicYear, editable, busy, onAcademicYearChange, onAdd }: {
  academicYear: string;
  editable: boolean;
  busy: boolean;
  onAcademicYearChange: (year: string) => void;
  onAdd: () => void;
}) {
  return <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
    <label className="w-48 text-sm font-medium text-text-primary">
      Academic Year
      <Select value={academicYear} onChange={(event) => onAcademicYearChange(event.target.value)} className="mt-1">
        <option value={CURRENT_ACADEMIC_YEAR}>{CURRENT_ACADEMIC_YEAR}</option>
        <option value={PRIOR_ACADEMIC_YEAR}>{PRIOR_ACADEMIC_YEAR}</option>
      </Select>
    </label>
    {editable && <Button type="button" onClick={onAdd} disabled={busy}>
      <Plus className="h-4 w-4" aria-hidden="true" /> Add Phase
    </Button>}
  </div>;
}

type PlanContentProps = {
  plan: Plan | null;
  academicYear: string;
  draft: Draft | null;
  selectedPhase: Phase | undefined;
  definitionReadOnly: boolean;
  busy: boolean;
  onCreate: (copy: boolean) => Promise<void>;
  onEdit: (phase: Phase) => void;
  onMove: (index: number, offset: -1 | 1) => Promise<void>;
  onRemove: (phase: Phase) => Promise<void>;
  onDraftChange: (draft: Draft) => void;
  onChangeState: (phase: Phase) => Promise<void>;
  onSave: () => Promise<void>;
};

function PlanContent(props: PlanContentProps) {
  if (!props.plan) {
    return <MissingPlan academicYear={props.academicYear} busy={props.busy} onCreate={props.onCreate} />;
  }
  return <ConfiguredPlan {...props} plan={props.plan} />;
}

function MissingPlan({ academicYear, busy, onCreate }: {
  academicYear: string;
  busy: boolean;
  onCreate: (copy: boolean) => Promise<void>;
}) {
  if (academicYear !== CURRENT_ACADEMIC_YEAR) {
    return <p className="py-12 text-center text-sm text-text-muted">No prior-year Plan.</p>;
  }
  return <div className="flex min-h-48 flex-col items-center justify-center gap-3 border border-dashed border-border p-6 text-center">
    <p className="text-sm text-text-secondary">No Plan exists for {CURRENT_ACADEMIC_YEAR}.</p>
    <div className="flex flex-wrap justify-center gap-2">
      <Button type="button" onClick={() => void onCreate(false)} disabled={busy}>Create blank Plan</Button>
      <Button type="button" variant="secondary" onClick={() => void onCreate(true)} disabled={busy}>Copy {PRIOR_ACADEMIC_YEAR} Plan</Button>
    </div>
  </div>;
}

function ConfiguredPlan(props: PlanContentProps & { plan: Plan }) {
  return <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(24rem,1.4fr)]">
    <PhaseList plan={props.plan} selectedId={props.draft?.id} busy={props.busy}
      onEdit={props.onEdit} onMove={props.onMove} onRemove={props.onRemove} />
    {props.draft
      ? <PhaseEditor draft={props.draft} plan={props.plan} selectedPhase={props.selectedPhase}
          definitionReadOnly={props.definitionReadOnly} busy={props.busy} onChange={props.onDraftChange}
          onChangeState={props.onChangeState} onSave={props.onSave} />
      : <p className="py-12 text-center text-sm text-text-muted">Select a Phase or add one.</p>}
  </div>;
}

function PhaseList({ plan, selectedId, busy, onEdit, onMove, onRemove }: {
  plan: Plan;
  selectedId?: number;
  busy: boolean;
  onEdit: (phase: Phase) => void;
  onMove: (index: number, offset: -1 | 1) => Promise<void>;
  onRemove: (phase: Phase) => Promise<void>;
}) {
  return <div className="divide-y divide-border border-y border-border">
    {plan.phases.length === 0 && <p className="py-10 text-center text-sm text-text-muted">No Phases configured.</p>}
    {plan.phases.map((phase, index) => <PhaseListItem key={phase.id} phase={phase}
      previous={plan.phases[index - 1]} next={plan.phases[index + 1]} index={index}
      editable={plan.editable} selected={selectedId === phase.id} busy={busy}
      onEdit={onEdit} onMove={onMove} onRemove={onRemove} />)}
  </div>;
}

function PhaseListItem({ phase, previous, next, index, editable, selected, busy, onEdit, onMove, onRemove }: {
  phase: Phase;
  previous?: Phase;
  next?: Phase;
  index: number;
  editable: boolean;
  selected: boolean;
  busy: boolean;
  onEdit: (phase: Phase) => void;
  onMove: (index: number, offset: -1 | 1) => Promise<void>;
  onRemove: (phase: Phase) => Promise<void>;
}) {
  return <div className={`flex gap-3 px-2 py-3 ${selected ? "bg-selected-bg" : ""}`}>
    <button type="button" onClick={() => onEdit(phase)} className="min-w-0 flex-1 text-left">
      <span className="text-xs font-semibold text-text-muted">Phase {phase.number} · Grade {phase.grade}</span>
      <span className="block truncate text-sm font-semibold text-text-primary">{phase.title}</span>
      <span className="text-xs text-text-secondary">{phaseStatusLabel(phase)}</span>
    </button>
    <PhaseListActions phase={phase} previous={previous} next={next} index={index} editable={editable}
      busy={busy} onMove={onMove} onRemove={onRemove} />
  </div>;
}

function phaseStatusLabel(phase: Phase) {
  const state = phase.state === "open" ? "Open" : "Locked";
  return phase.active ? `${state} · Active` : state;
}

function PhaseListActions({ phase, previous, next, index, editable, busy, onMove, onRemove }: {
  phase: Phase;
  previous?: Phase;
  next?: Phase;
  index: number;
  editable: boolean;
  busy: boolean;
  onMove: (index: number, offset: -1 | 1) => Promise<void>;
  onRemove: (phase: Phase) => Promise<void>;
}) {
  if (!editable) return null;
  const mutable = phaseIsMutable(phase, editable);
  const canMoveUp = mutable && phaseIsMutable(previous, editable);
  const canMoveDown = mutable && phaseIsMutable(next, editable);
  return <div className="flex shrink-0 items-center">
    <Button type="button" variant="icon" size="sm" title="Move up" aria-label={`Move Phase ${phase.number} up`}
      disabled={!canMoveUp || busy} onClick={() => void onMove(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
    <Button type="button" variant="icon" size="sm" title="Move down" aria-label={`Move Phase ${phase.number} down`}
      disabled={!canMoveDown || busy} onClick={() => void onMove(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
    <Button type="button" variant="icon" size="sm" title="Delete" aria-label={`Delete Phase ${phase.number}`}
      disabled={!mutable || busy} onClick={() => void onRemove(phase)}><Trash2 className="h-4 w-4" /></Button>
  </div>;
}

function updateQuestion(draft: Draft, index: number, text: string): Draft {
  return {
    ...draft,
    questions: draft.questions.map((question, questionIndex) => questionIndex === index ? { ...question, text } : question),
  };
}

function removeQuestion(draft: Draft, index: number): Draft {
  return { ...draft, questions: draft.questions.filter((_, questionIndex) => questionIndex !== index) };
}

function PhaseEditor({ draft, plan, selectedPhase, definitionReadOnly, busy, onChange, onChangeState, onSave }: {
  draft: Draft;
  plan: Plan;
  selectedPhase: Phase | undefined;
  definitionReadOnly: boolean;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onChangeState: (phase: Phase) => Promise<void>;
  onSave: () => Promise<void>;
}) {
  const identityReadOnly = !plan.editable || !!draft.everOpened;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
      <label className="text-sm font-medium text-text-primary">Grade
        <Select className="mt-1" value={draft.grade} disabled={identityReadOnly}
          onChange={(event) => onChange({ ...draft, grade: Number(event.target.value) as 11 | 12 })}>
          <option value={11}>11</option><option value={12}>12</option>
        </Select>
      </label>
      <label className="text-sm font-medium text-text-primary">Title
        <Input className="mt-1" maxLength={120} value={draft.title} disabled={identityReadOnly}
          onChange={(event) => onChange({ ...draft, title: event.target.value })} />
      </label>
    </div>
    <GuidanceEditor value={draft.guidanceMarkdown} readOnly={definitionReadOnly}
      onChange={(guidanceMarkdown) => onChange({ ...draft, guidanceMarkdown })} />
    <fieldset className="space-y-2" disabled={identityReadOnly}>
      <legend className="text-sm font-semibold text-text-primary">Questions</legend>
      {draft.questions.map((question, index) => <div key={question.id ?? index} className="flex gap-2">
        <Input aria-label={`Question ${index + 1}`} value={question.text}
          onChange={(event) => onChange(updateQuestion(draft, index, event.target.value))} />
        <Button type="button" variant="icon" title="Remove Question" aria-label={`Remove Question ${index + 1}`}
          disabled={draft.questions.length === 1} onClick={() => onChange(removeQuestion(draft, index))}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>)}
      <Button type="button" variant="secondary" size="sm" disabled={draft.questions.length === 4}
        onClick={() => onChange({ ...draft, questions: [...draft.questions, { text: "" }] })}>
        <Plus className="h-4 w-4" /> Add Question
      </Button>
    </fieldset>
    {plan.editable && <PhaseEditorActions phase={selectedPhase} busy={busy} definitionReadOnly={definitionReadOnly}
      onChangeState={onChangeState} onSave={onSave} />}
  </div>;
}

function PhaseEditorActions({ phase, busy, definitionReadOnly, onChangeState, onSave }: {
  phase: Phase | undefined;
  busy: boolean;
  definitionReadOnly: boolean;
  onChangeState: (phase: Phase) => Promise<void>;
  onSave: () => Promise<void>;
}) {
  return <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
    <div>{phase && <Button type="button" variant="secondary" onClick={() => void onChangeState(phase)}
      disabled={busy || phase.frozen || phase.used}>{phase.state === "open" ? "Return to Locked" : "Open Phase"}</Button>}</div>
    <Button type="button" onClick={() => void onSave()} disabled={busy || definitionReadOnly}>Save Phase</Button>
  </div>;
}
