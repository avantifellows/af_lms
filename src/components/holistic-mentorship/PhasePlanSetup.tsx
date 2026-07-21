"use client";

import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, History, Lock, Milestone, MoreVertical, Plus, Save, Snowflake, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Input } from "@/components/ui";
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
  request: (method: string, payload: Record<string, unknown>, reload?: boolean) => Promise<Record<string, unknown> | false>
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
  return window.confirm("Save changes to this previously opened Phase?");
}

function selectedDraftPhase(plan: Plan | null | undefined, draft: Draft | null) {
  if (!draft?.id) return undefined;
  return plan?.phases.find((phase) => phase.id === draft.id);
}

function isDefinitionReadOnly(plan: Plan | null | undefined, selectedPhase: Phase | undefined) {
  if (!plan?.editable) return true;
  return !!selectedPhase && (selectedPhase.frozen || selectedPhase.used);
}

function normalizedQuestions(questions: Question[]) {
  return questions.map((question) => ({ id: question.id ?? null, text: question.text }));
}

function draftIsDirty(draft: Draft, phase: Phase | undefined) {
  if (!phase) return true;
  return draft.grade !== phase.grade ||
    draft.title !== phase.title ||
    draft.guidanceMarkdown !== phase.guidanceMarkdown ||
    JSON.stringify(normalizedQuestions(draft.questions)) !== JSON.stringify(normalizedQuestions(phase.questions));
}

function draftFromPhase(phase: Phase): Draft {
  return {
    id: phase.id,
    revision: phase.revision,
    grade: phase.grade,
    title: phase.title,
    guidanceMarkdown: phase.guidanceMarkdown,
    questions: phase.questions.map((question) => ({ ...question })),
    everOpened: phase.everOpened,
  };
}

export default function PhasePlanSetup({ academicYear = CURRENT_ACADEMIC_YEAR }: { academicYear?: string }) {
  const [plan, setPlan] = useState<Plan | null | undefined>();
  const [canCopyPriorPlan, setCanCopyPriorPlan] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedPhase = selectedDraftPhase(plan, draft);
  const definitionReadOnly = isDefinitionReadOnly(plan, selectedPhase);

  const load = useCallback(async (year = academicYear, selectPhaseId?: number) => {
    setPlan(undefined);
    setCanCopyPriorPlan(false);
    setDraft(null);
    setMessage("");
    try {
      const result = await fetch(`/api/holistic-mentorship/phase-plans?academic_year=${year}`);
      const data = await result.json();
      if (!result.ok) setMessage(data.error ?? "Could not load the Plan");
      const nextPlan: Plan | null = data.plan ?? null;
      if (!nextPlan && year === CURRENT_ACADEMIC_YEAR) {
        const priorResult = await fetch(`/api/holistic-mentorship/phase-plans?academic_year=${PRIOR_ACADEMIC_YEAR}`);
        const priorData = await priorResult.json();
        setCanCopyPriorPlan(priorResult.ok && !!priorData.plan);
      }
      setPlan(nextPlan);
      const keep = selectPhaseId ? nextPlan?.phases.find((phase) => phase.id === selectPhaseId) : undefined;
      if (keep) setDraft(draftFromPhase(keep));
    } catch {
      setMessage("Could not load the Plan");
      setCanCopyPriorPlan(false);
      setPlan(null);
    }
  }, [academicYear]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!plan || draft || plan.phases.length === 0) return;
    setDraft(draftFromPhase(plan.phases[0]));
  }, [plan, draft]);

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
      return (data ?? {}) as Record<string, unknown>;
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
    setDraft(draftFromPhase(phase));
    setMessage("");
  }

  async function save() {
    if (!draft) return;
    const phase = draft.id ? plan?.phases.find((item) => item.id === draft.id) : null;
    if (!confirmPreviouslyOpenedPhase(phase)) return;
    const saved = await persistDraft(draft, academicYear, !!phase?.everOpened, request);
    if (!saved) return;
    const savedId = draft.id ?? (typeof saved.id === "number" ? saved.id : undefined);
    await load(academicYear, savedId);
  }

  function discard() {
    if (selectedPhase) setDraft(draftFromPhase(selectedPhase));
    else if (plan && plan.phases.length > 0) setDraft(draftFromPhase(plan.phases[0]));
    else setDraft(null);
    setMessage("");
  }

  async function changeState(phase: Phase) {
    const next = phase.state === "locked" ? "open" : "locked";
    if (!window.confirm(`${next === "open" ? "Open" : "Return to Locked"} Phase ${phase.number}?`)) return;
    const changed = await request("PATCH",
      { action: "state", phase_id: phase.id, expected_revision: phase.revision, state: next, confirmed: true }, false);
    if (changed) await load(academicYear, phase.id);
  }

  async function remove(phase: Phase) {
    if (!window.confirm(`Delete Phase ${phase.number}?`)) return;
    await request("DELETE", { phase_id: phase.id, expected_revision: phase.revision });
  }

  async function move(index: number, offset: -1 | 1) {
    if (!plan) return;
    const moved = plan.phases[index];
    const reordered = [...plan.phases];
    [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
    const saved = await request("PATCH", {
      action: "reorder",
      academic_year: academicYear,
      phases: reordered.map((phase) => ({ id: phase.id, expected_revision: phase.revision })),
    }, false);
    if (saved) await load(academicYear, moved.id);
  }

  if (plan === undefined) return <p role="status" className="py-12 text-center text-sm text-text-muted">Loading Phase Plan...</p>;

  return (
    <section className="space-y-5" aria-label="Phase Setup">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">Phase Setup</h2>
        {plan?.editable && <Button type="button" onClick={() => setDraft(emptyDraft())} disabled={busy}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Phase
        </Button>}
      </div>
      {message && <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{message}</p>}
      <PlanContent plan={plan ?? null} academicYear={academicYear} draft={draft} selectedPhase={selectedPhase}
        definitionReadOnly={definitionReadOnly} busy={busy} canCopyPriorPlan={canCopyPriorPlan}
        onCreate={create} onEdit={edit} onMove={move}
        onRemove={remove} onDraftChange={setDraft} onChangeState={changeState} onSave={save} onDiscard={discard} />
    </section>
  );
}

type PlanContentProps = {
  plan: Plan | null;
  academicYear: string;
  draft: Draft | null;
  selectedPhase: Phase | undefined;
  definitionReadOnly: boolean;
  busy: boolean;
  canCopyPriorPlan: boolean;
  onCreate: (copy: boolean) => Promise<void>;
  onEdit: (phase: Phase) => void;
  onMove: (index: number, offset: -1 | 1) => Promise<void>;
  onRemove: (phase: Phase) => Promise<void>;
  onDraftChange: (draft: Draft) => void;
  onChangeState: (phase: Phase) => Promise<void>;
  onSave: () => Promise<void>;
  onDiscard: () => void;
};

function PlanContent(props: PlanContentProps) {
  if (!props.plan) {
    return <MissingPlan academicYear={props.academicYear} busy={props.busy}
      canCopyPriorPlan={props.canCopyPriorPlan} onCreate={props.onCreate} />;
  }
  return <ConfiguredPlan {...props} plan={props.plan} />;
}

function MissingPlan({ academicYear, busy, canCopyPriorPlan, onCreate }: {
  academicYear: string;
  busy: boolean;
  canCopyPriorPlan: boolean;
  onCreate: (copy: boolean) => Promise<void>;
}) {
  if (academicYear !== CURRENT_ACADEMIC_YEAR) {
    return <p className="py-12 text-center text-sm text-text-muted">No prior-year Plan.</p>;
  }
  return <div className="flex min-h-72 flex-col items-center justify-center gap-3 border border-dashed border-border p-6 text-center">
    <Milestone aria-hidden="true" className="h-8 w-8 text-text-muted" />
    <p className="text-base font-semibold text-text-primary">Create the {CURRENT_ACADEMIC_YEAR} Phase Plan</p>
    <p className="text-sm text-text-muted">{canCopyPriorPlan
      ? "Start with no Phases, or copy last year's definitions into new Locked Phases."
      : "Start with no Phases and add them from this workspace."}</p>
    <div className="flex flex-wrap justify-center gap-2">
      <Button type="button" variant="secondary" onClick={() => void onCreate(false)} disabled={busy}>Start blank</Button>
      {canCopyPriorPlan && <Button type="button" onClick={() => void onCreate(true)} disabled={busy}>
        <Copy aria-hidden="true" className="h-4 w-4" /> Copy previous year
      </Button>}
    </div>
  </div>;
}

function ConfiguredPlan(props: PlanContentProps & { plan: Plan }) {
  return <div className="grid gap-5 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(24rem,1.6fr)]">
    <aside className="min-w-0 rounded-md border border-border bg-bg-card-alt">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wide text-text-secondary">{props.plan.academicYear} Phase Plan</h3>
        {!props.plan.editable && <Lock aria-hidden="true" className="h-4 w-4 text-text-muted" />}
      </div>
      <nav aria-label="Ordered Phase Plan">
        {props.plan.phases.length === 0 && <p className="py-10 text-center text-sm text-text-muted">No Phases configured.</p>}
        {props.plan.phases.map((phase) => <PhaseListItem key={phase.id} phase={phase}
          selected={props.draft?.id === phase.id} onEdit={props.onEdit} />)}
      </nav>
    </aside>
    {props.draft
      ? <PhaseEditor draft={props.draft} plan={props.plan} selectedPhase={props.selectedPhase}
          definitionReadOnly={props.definitionReadOnly} busy={props.busy} onChange={props.onDraftChange}
          onChangeState={props.onChangeState} onSave={props.onSave} onDiscard={props.onDiscard}
          onMove={props.onMove} onRemove={props.onRemove} />
      : <p className="py-12 text-center text-sm text-text-muted">Select a Phase or add one.</p>}
  </div>;
}

function PhaseListItem({ phase, selected, onEdit }: {
  phase: Phase;
  selected: boolean;
  onEdit: (phase: Phase) => void;
}) {
  return <button type="button" aria-pressed={selected} aria-current={selected} onClick={() => onEdit(phase)}
    className={`grid w-full min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 border-l-4 px-2.5 py-2 text-left transition-colors hover:bg-accent/5 ${
      selected ? "border-accent bg-bg-card" : "border-transparent"
    }`}>
    <span className={`text-center text-xs font-extrabold ${selected ? "text-accent" : "text-text-muted"}`}>{phase.number}</span>
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold text-text-primary">{phase.title || "Untitled Phase"}</span>
      <PhaseListStatus phase={phase} />
    </span>
  </button>;
}

function PhaseListStatus({ phase }: { phase: Phase }) {
  if (phase.active) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />Active
    </span>;
  }
  if (phase.state === "locked") {
    return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-text-muted">
      <Lock aria-hidden="true" className="h-3 w-3" />Locked
    </span>;
  }
  return <span className="text-[11px] font-bold text-text-muted">Open</span>;
}

function phaseStatusLabel(phase: Phase) {
  return phase.active ? "Active" : phase.state === "open" ? "Open" : "Locked";
}

function InlineAlert({ tone, icon, title, copy }: {
  tone: "info" | "warning";
  icon: React.ReactNode;
  title: string;
  copy: string;
}) {
  return <div className={`flex items-start gap-3 rounded-md p-3 text-sm ${tone === "warning" ? "bg-warning-bg" : "bg-info-bg"}`}>
    <span aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted">{icon}</span>
    <p className="text-text-secondary"><strong className="text-text-primary">{title}</strong> {copy}</p>
  </div>;
}

function PhaseEditor({ draft, plan, selectedPhase, definitionReadOnly, busy, onChange, onChangeState, onSave, onDiscard, onMove, onRemove }: {
  draft: Draft;
  plan: Plan;
  selectedPhase: Phase | undefined;
  definitionReadOnly: boolean;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onChangeState: (phase: Phase) => Promise<void>;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onMove: (index: number, offset: -1 | 1) => Promise<void>;
  onRemove: (phase: Phase) => Promise<void>;
}) {
  const identityReadOnly = definitionReadOnly;
  const phase = selectedPhase;
  const dirty = draftIsDirty(draft, phase);
  return <article className="min-w-0 rounded-md border border-border bg-bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary">
          {phase ? `Phase ${phase.number} - ${phase.title || "Untitled Phase"}` : "New Phase"}
        </h3>
        <p className="text-sm text-text-muted">
          Grade {draft.grade}{phase ? ` - ${phaseStatusLabel(phase)}${phase.used ? " - Started" : ""}` : ""}
        </p>
      </div>
      {plan.editable && phase && <PhaseLifecycleActions phase={phase} plan={plan} busy={busy}
        onChangeState={onChangeState} onMove={onMove} onRemove={onRemove} />}
    </div>
    <div className="space-y-5 px-4 py-4">
      {phase?.used && <InlineAlert tone="info" icon={<Snowflake className="h-4 w-4" />} title="Definition frozen."
        copy="A Mentor has saved Notes for this Phase. Title, Grade, Guidance, Questions, and position are now read-only." />}
      {!plan.editable && <InlineAlert tone="info" icon={<History className="h-4 w-4" />} title="Historical Phase Plan."
        copy="Prior Academic Year definitions and state are read-only." />}
      {plan.editable && phase?.state === "open" && !phase.used && <InlineAlert tone="warning" icon={<Eye className="h-4 w-4" />}
        title="Mentors can see this Phase." copy="Saved Guidance and Question changes are visible immediately across Program 1." />}
      <section>
        <h4 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-text-secondary">Definition</h4>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="text-[11px] font-extrabold uppercase tracking-wide text-text-muted">Phase title
            <Input className="mt-1 font-normal normal-case tracking-normal" aria-label="Title" maxLength={120} value={draft.title} disabled={identityReadOnly}
              onChange={(event) => onChange({ ...draft, title: event.target.value })} />
          </label>
          <fieldset disabled={identityReadOnly}>
            <legend className="text-[11px] font-extrabold uppercase tracking-wide text-text-muted">Grade</legend>
            <div role="group" aria-label="Grade" className="mt-1 inline-flex rounded-md border border-border bg-bg-card-alt p-1">
              {([11, 12] as const).map((grade) => (
                <button key={grade} type="button" aria-pressed={draft.grade === grade}
                  onClick={() => onChange({ ...draft, grade })}
                  className={`min-h-9 rounded px-3 text-sm font-semibold transition-colors ${
                    draft.grade === grade ? "bg-bg-card text-accent shadow-sm" : "text-text-secondary"
                  }`}>
                  Grade {grade}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </section>
      <section>
        <h4 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-text-secondary">Phase Guidance</h4>
        <GuidanceEditor value={draft.guidanceMarkdown} readOnly={definitionReadOnly}
          onChange={(guidanceMarkdown) => onChange({ ...draft, guidanceMarkdown })} />
      </section>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-extrabold uppercase tracking-wide text-text-secondary">Post-Session Questions</h4>
          {!identityReadOnly && <Button type="button" variant="secondary" className="text-xs"
            disabled={draft.questions.length === 4}
            title={draft.questions.length === 4 ? "Maximum 4 questions" : undefined}
            onClick={() => onChange({ ...draft, questions: [...draft.questions, { text: "" }] })}>
            <Plus className="h-4 w-4" /> Add Question
          </Button>}
        </div>
        <fieldset className="space-y-2" disabled={identityReadOnly}>
          <legend className="sr-only">Questions</legend>
          {draft.questions.map((question, index) => <div key={question.id ?? index}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)_repeat(3,2.75rem)] items-center gap-2">
            <span aria-hidden="true" className="text-center text-xs font-extrabold text-text-muted">{index + 1}</span>
            <Input className="min-w-0" aria-label={`Question ${index + 1}`} value={question.text}
              onChange={(event) => onChange(updateQuestion(draft, index, event.target.value))} />
            <Button type="button" variant="icon" title="Move Question up" aria-label={`Move Question ${index + 1} up`}
              disabled={index === 0} onClick={() => onChange(moveQuestion(draft, index, -1))}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="icon" title="Move Question down" aria-label={`Move Question ${index + 1} down`}
              disabled={index === draft.questions.length - 1} onClick={() => onChange(moveQuestion(draft, index, 1))}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="icon" title="Remove Question" aria-label={`Remove Question ${index + 1}`}
              disabled={draft.questions.length === 1} onClick={() => onChange(removeQuestion(draft, index))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>)}
          {draft.questions.length === 0 && <InlineAlert tone="warning" icon={<TriangleAlert className="h-4 w-4" />}
            title="No Questions yet." copy="Add at least one Question before Opening this Phase." />}
        </fieldset>
      </section>
    </div>
    {plan.editable && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-4">
      {dirty && !definitionReadOnly && <p role="status" className="mr-auto text-xs font-semibold text-warning-text">Unsaved changes</p>}
      <Button type="button" variant="secondary" onClick={onDiscard} disabled={busy || definitionReadOnly || !dirty}>Discard</Button>
      <Button type="button" onClick={() => void onSave()} disabled={busy || definitionReadOnly || !dirty}>
        <Save aria-hidden="true" className="h-4 w-4" /> Save Phase
      </Button>
    </footer>}
  </article>;
}

function PhaseLifecycleActions({ phase, plan, busy, onChangeState, onMove, onRemove }: {
  phase: Phase;
  plan: Plan;
  busy: boolean;
  onChangeState: (phase: Phase) => Promise<void>;
  onMove: (index: number, offset: -1 | 1) => Promise<void>;
  onRemove: (phase: Phase) => Promise<void>;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const index = plan.phases.findIndex((item) => item.id === phase.id);
  const mutable = phaseIsMutable(phase, plan.editable);
  const canMoveUp = mutable && phaseIsMutable(plan.phases[index - 1], plan.editable);
  const canMoveDown = mutable && phaseIsMutable(plan.phases[index + 1], plan.editable);
  const closeMenu = () => { if (menuRef.current) menuRef.current.open = false; };
  return <div className="flex items-center gap-2">
    <Button type="button" variant={phase.state === "locked" ? "primary" : "secondary"}
      onClick={() => void onChangeState(phase)} disabled={busy || phase.frozen || phase.used}>
      {phase.state === "locked"
        ? <><Eye aria-hidden="true" className="h-4 w-4" /> Open Phase</>
        : <><EyeOff aria-hidden="true" className="h-4 w-4" /> Return to Locked</>}
    </Button>
    {mutable && <details ref={menuRef} className="relative">
      <summary aria-label="More Phase actions" title="More Phase actions"
        className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md p-2 text-text-muted hover:bg-hover-bg hover:text-text-primary [&::-webkit-details-marker]:hidden">
        <MoreVertical aria-hidden="true" className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-border bg-bg-card p-1 shadow-lg">
        <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-text-primary hover:bg-hover-bg disabled:opacity-50"
          aria-label={`Move Phase ${phase.number} up`} disabled={!canMoveUp || busy}
          onClick={() => { closeMenu(); void onMove(index, -1); }}>
          <ArrowUp aria-hidden="true" className="h-4 w-4" /> Move up
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-text-primary hover:bg-hover-bg disabled:opacity-50"
          aria-label={`Move Phase ${phase.number} down`} disabled={!canMoveDown || busy}
          onClick={() => { closeMenu(); void onMove(index, 1); }}>
          <ArrowDown aria-hidden="true" className="h-4 w-4" /> Move down
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-danger hover:bg-danger-bg disabled:opacity-50"
          aria-label={`Delete Phase ${phase.number}`} disabled={busy}
          onClick={() => { closeMenu(); void onRemove(phase); }}>
          <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete Phase
        </button>
      </div>
    </details>}
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

function moveQuestion(draft: Draft, index: number, offset: -1 | 1): Draft {
  const questions = [...draft.questions];
  [questions[index], questions[index + offset]] = [questions[index + offset], questions[index]];
  return { ...draft, questions };
}
