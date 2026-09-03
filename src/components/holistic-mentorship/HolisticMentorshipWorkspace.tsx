"use client";

import { useCallback, useId, useRef, useState } from "react";

import { Select } from "@/components/ui";
import {
  CURRENT_ACADEMIC_YEAR,
  HOLISTIC_MENTORSHIP_PROGRAM_IDS,
  PROGRAM_IDS,
  PROGRAM_ID_TO_LABEL,
} from "@/lib/constants";
import HolisticTutorialLink from "./HolisticTutorialLink";
import PhasePlanSetup from "./PhasePlanSetup";
import ProgressWorkspace from "./ProgressWorkspace";
import TeacherMappingWorkspace from "./TeacherMappingWorkspace";

type WorkspaceMode = "teacher" | "admin";

const WORKSPACES = {
  admin: [
    { id: "progress", label: "Students & Progress" },
    { id: "phases", label: "Phase Setup" },
  ],
} as const;

type Workspace = (typeof WORKSPACES.admin)[number];

type HolisticMentorshipWorkspaceProps = {
  mode: WorkspaceMode;
  schoolCode?: string;
  programId?: number;
  initialProgramId?: number;
  availableProgramIds?: number[];
  canEdit?: boolean;
  canViewPhaseSetup?: boolean;
};

function nextWorkspaceIndex(key: string, index: number, count: number) {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function orderedProgramIds(programIds: number[]) {
  const available = new Set(programIds);
  return HOLISTIC_MENTORSHIP_PROGRAM_IDS.filter((programId) => available.has(programId));
}

function AdminSelectors({ selectedProgramId, availableProgramIds, academicYear, academicYears,
  onProgramChange, onAcademicYearChange }: {
  selectedProgramId: number;
  availableProgramIds: number[];
  academicYear: string;
  academicYears: string[];
  onProgramChange: (programId: number) => void;
  onAcademicYearChange: (academicYear: string) => void;
}) {
  return <div className="grid gap-3 rounded-md border border-border bg-bg-card p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
    <label className="block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
      Program
      <Select aria-label="Program" className="mt-1 w-full font-normal normal-case tracking-normal"
        value={selectedProgramId} onChange={(event) => onProgramChange(Number(event.target.value))}>
        {availableProgramIds.map((id) => <option key={id} value={id}>
          {id} - {PROGRAM_ID_TO_LABEL[id]}
        </option>)}
      </Select>
    </label>
    <label className="block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
      Academic Year
      <Select aria-label="Academic Year" className="mt-1 w-full font-mono font-normal normal-case tracking-normal"
        value={academicYear} onChange={(event) => onAcademicYearChange(event.target.value)}>
        {academicYears.map((year) => <option key={year}>{year}</option>)}
      </Select>
    </label>
  </div>;
}

function WorkspaceTabs({ workspaces, active, tabSetId, tabRefs, onActivate, onKeyDown }: {
  workspaces: readonly Workspace[];
  active: Workspace;
  tabSetId: string;
  tabRefs: React.RefObject<Array<HTMLButtonElement | null>>;
  onActivate: (workspaceId: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => void;
}) {
  return <div aria-label="Holistic Mentorship sections"
    className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
    {workspaces.map((workspace, index) => <button
      key={workspace.id}
      ref={(element) => { tabRefs.current[index] = element; }}
      id={`${tabSetId}-${workspace.id}-tab`}
      type="button"
      role="tab"
      aria-selected={workspace.id === active.id}
      aria-controls={`${tabSetId}-panel`}
      tabIndex={workspace.id === active.id ? 0 : -1}
      onClick={() => onActivate(workspace.id)}
      onKeyDown={(event) => onKeyDown(event, index)}
      className={`-mb-px min-h-12 shrink-0 border-b-2 px-4 text-xs font-extrabold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 ${
        workspace.id === active.id
          ? "border-accent text-accent"
          : "border-transparent text-text-secondary hover:bg-accent/5 hover:text-text-primary"
      }`}
    >
      {workspace.label}
    </button>)}
  </div>;
}

function WorkspacePanel({ active, tabSetId, academicYear, programId, canEdit,
  onAcademicYears }: {
  active: Workspace;
  tabSetId: string;
  academicYear: string;
  programId: number;
  canEdit: boolean;
  onAcademicYears: (years: string[]) => void;
}) {
  return <div id={`${tabSetId}-panel`} role="tabpanel"
    aria-labelledby={`${tabSetId}-${active.id}-tab`} tabIndex={0}
    className="min-w-0 max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
    {active.id === "phases"
      ? <PhasePlanSetup academicYear={academicYear} programId={programId} canEdit={canEdit} />
      : <ProgressWorkspace academicYear={academicYear} programId={programId}
          onAcademicYears={onAcademicYears} />}
  </div>;
}

function AdminWorkspace({
  initialProgramId = PROGRAM_IDS.COE,
  availableProgramIds = [...HOLISTIC_MENTORSHIP_PROGRAM_IDS],
  canEdit = true,
  canViewPhaseSetup = canEdit,
}: Omit<HolisticMentorshipWorkspaceProps, "mode" | "schoolCode" | "programId">) {
  const orderedAvailableProgramIds = orderedProgramIds(availableProgramIds);
  const workspaces = canViewPhaseSetup ? WORKSPACES.admin : WORKSPACES.admin.slice(0, 1);
  const [activeId, setActiveId] = useState<string>(workspaces[0].id);
  const active = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];
  const tabSetId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [academicYear, setAcademicYear] = useState(CURRENT_ACADEMIC_YEAR);
  const [selectedProgramId, setSelectedProgramId] = useState(initialProgramId);
  const [academicYears, setAcademicYears] = useState<string[]>([CURRENT_ACADEMIC_YEAR]);
  const updateAcademicYears = useCallback((years: string[]) => {
    if (years.length === 0) return;
    setAcademicYears((current) => {
      return years.length === current.length && years.every((year, index) => year === current[index])
        ? current
        : years;
    });
  }, []);

  const activateWorkspace = (workspaceId: string) => {
    setActiveId(workspaceId);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextWorkspaceIndex(event.key, index, workspaces.length);
    if (nextIndex === null) return;

    event.preventDefault();
    activateWorkspace(workspaces[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };
  const handleProgramChange = (nextProgramId: number) => {
    setSelectedProgramId(nextProgramId);
    setAcademicYear(CURRENT_ACADEMIC_YEAR);
    setAcademicYears([CURRENT_ACADEMIC_YEAR]);
  };

  return (
    <section className="min-w-0 max-w-full space-y-4">
      <div className="flex justify-end">
        <HolisticTutorialLink />
      </div>
      <AdminSelectors selectedProgramId={selectedProgramId} availableProgramIds={orderedAvailableProgramIds}
        academicYear={academicYear} academicYears={academicYears}
        onProgramChange={handleProgramChange} onAcademicYearChange={setAcademicYear} />
      <WorkspaceTabs workspaces={workspaces} active={active} tabSetId={tabSetId}
        tabRefs={tabRefs} onActivate={activateWorkspace} onKeyDown={handleTabKeyDown} />
      <WorkspacePanel active={active} tabSetId={tabSetId} academicYear={academicYear}
        programId={selectedProgramId} canEdit={canEdit} onAcademicYears={updateAcademicYears} />
    </section>
  );
}

export default function HolisticMentorshipWorkspace({
  mode,
  schoolCode,
  programId,
  initialProgramId,
  availableProgramIds,
  canEdit = true,
  canViewPhaseSetup,
}: HolisticMentorshipWorkspaceProps) {
  if (mode === "teacher") {
    return schoolCode
      ? <TeacherMappingWorkspace schoolCode={schoolCode}
          programId={programId ?? PROGRAM_IDS.COE} canEdit={canEdit} />
      : null;
  }
  return <AdminWorkspace initialProgramId={initialProgramId}
    availableProgramIds={availableProgramIds} canEdit={canEdit}
    canViewPhaseSetup={canViewPhaseSetup} />;
}
