"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Select } from "@/components/ui";
import {
  CURRENT_ACADEMIC_YEAR,
  HOLISTIC_MENTORSHIP_PROGRAM_IDS,
  PROGRAM_IDS,
  PROGRAM_ID_TO_LABEL,
} from "@/lib/constants";
import { resolveVisibleTab } from "@/lib/roster-tabs";
import ChallengeCategoryHeatmap from "./ChallengeCategoryHeatmap";
import HolisticTutorialLink from "./HolisticTutorialLink";
import PhasePlanSetup from "./PhasePlanSetup";
import ProgressWorkspace from "./ProgressWorkspace";
import TeacherMappingWorkspace from "./TeacherMappingWorkspace";

type WorkspaceMode = "teacher" | "admin";

const WORKSPACES = {
  admin: [
    { id: "progress", label: "Students & Progress" },
    { id: "challenge-categories", label: "Challenge Categories" },
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

// Rewrite one query parameter in place (no history entry), keeping the rest and
// the hash. Next's patched history API surfaces it through useSearchParams.
function replaceSearchParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

type UrlChoice = { search: string; programId?: number; tab?: string };

// The URL holds the Program (`program_id`) and the tab (`tab`, absent for the
// first tab). A choice shows at once, ahead of its replace reaching
// useSearchParams; once the URL moves on, the URL wins again. This keeps the
// heatmap from first loading the old Program.
function useUrlChoices(availableProgramIds: number[], initialProgramId: number, tabIds: string[]) {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [choice, setChoice] = useState<UrlChoice | null>(null);
  const pending = choice?.search === search ? choice : null;
  const programParams = searchParams.getAll("program_id");
  const requestedProgramId = programParams.length === 1 ? Number(programParams[0]) : NaN;
  const urlProgramId = availableProgramIds.includes(requestedProgramId) ? requestedProgramId : initialProgramId;
  // A hidden or unknown `tab` (Phase Setup for a Program Manager) falls back to the first tab.
  const urlTab = resolveVisibleTab(searchParams.get("tab"), tabIds, tabIds[0]);
  const choose = (next: Omit<UrlChoice, "search">) =>
    setChoice((current) => ({ ...(current?.search === search ? current : {}), ...next, search }));
  return {
    programId: pending?.programId ?? urlProgramId,
    activeId: pending?.tab ?? urlTab,
    chooseProgram: (programId: number) => {
      choose({ programId });
      replaceSearchParam("program_id", String(programId));
    },
    chooseTab: (tab: string) => {
      choose({ tab });
      replaceSearchParam("tab", tab === tabIds[0] ? null : tab);
    },
  };
}

function AdminSelectors({ selectedProgramId, availableProgramIds, offerAllPrograms, academicYear,
  academicYears, onProgramChange, onAcademicYearChange }: {
  selectedProgramId: number | "all";
  availableProgramIds: number[];
  offerAllPrograms: boolean;
  academicYear: string;
  academicYears: string[];
  onProgramChange: (programId: number | "all") => void;
  onAcademicYearChange: (academicYear: string) => void;
}) {
  return <div className="grid gap-3 rounded-md border border-border bg-bg-card p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
    <label className="block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
      Program
      <Select aria-label="Program" className="mt-1 font-normal normal-case tracking-normal"
        value={selectedProgramId} onChange={(event) => onProgramChange(
          event.target.value === "all" ? "all" : Number(event.target.value))}>
        {offerAllPrograms && <option value="all">All Programs</option>}
        {availableProgramIds.map((id) => <option key={id} value={id}>
          {id} - {PROGRAM_ID_TO_LABEL[id]}
        </option>)}
      </Select>
    </label>
    <label className="block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
      Academic Year
      <Select aria-label="Academic Year" className="mt-1 font-mono font-normal normal-case tracking-normal"
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

function WorkspacePanel({ active, tabSetId, academicYear, programId, heatmapProgramId, canEdit,
  onAcademicYears }: {
  active: Workspace;
  tabSetId: string;
  academicYear: string;
  programId: number;
  heatmapProgramId: number | "all";
  canEdit: boolean;
  onAcademicYears: (years: string[]) => void;
}) {
  return <div id={`${tabSetId}-panel`} role="tabpanel"
    aria-labelledby={`${tabSetId}-${active.id}-tab`} tabIndex={0}
    className="min-w-0 max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
    {active.id === "phases"
      ? <PhasePlanSetup academicYear={academicYear} programId={programId} canEdit={canEdit} />
      : active.id === "challenge-categories"
        ? <ChallengeCategoryHeatmap academicYear={academicYear} programId={heatmapProgramId}
            onAcademicYears={onAcademicYears} />
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
  const workspaces = canViewPhaseSetup
    ? WORKSPACES.admin
    : WORKSPACES.admin.filter((workspace) => workspace.id !== "phases");
  const { programId: selectedProgramId, activeId, chooseProgram, chooseTab } = useUrlChoices(
    orderedAvailableProgramIds, initialProgramId, workspaces.map((workspace) => workspace.id));
  const active = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];
  // "All Programs" exists only on Challenge Categories for a multi-Program
  // viewer, who lands on it there first, even after picking a Program on
  // another tab. It never replaces the shared single Program (or the URL), so
  // other tabs get that Program back.
  const offerAllPrograms = active.id === "challenge-categories" && orderedAvailableProgramIds.length >= 2;
  const [heatmapAllPrograms, setHeatmapAllPrograms] = useState(true);
  const shownProgramId = offerAllPrograms && heatmapAllPrograms ? "all" : selectedProgramId;
  const tabSetId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [academicYear, setAcademicYear] = useState(CURRENT_ACADEMIC_YEAR);
  const [academicYears, setAcademicYears] = useState<string[]>([CURRENT_ACADEMIC_YEAR]);
  const updateAcademicYears = useCallback((years: string[]) => {
    if (years.length === 0) return;
    setAcademicYears((current) => {
      return years.length === current.length && years.every((year, index) => year === current[index])
        ? current
        : years;
    });
  }, []);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextWorkspaceIndex(event.key, index, workspaces.length);
    if (nextIndex === null) return;

    event.preventDefault();
    chooseTab(workspaces[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };
  const handleProgramChange = (nextProgramId: number | "all") => {
    // Only a choice made on the heatmap moves it off All Programs.
    if (offerAllPrograms) setHeatmapAllPrograms(nextProgramId === "all");
    setAcademicYear(CURRENT_ACADEMIC_YEAR);
    setAcademicYears([CURRENT_ACADEMIC_YEAR]);
    if (nextProgramId !== "all") chooseProgram(nextProgramId);
  };

  return (
    <section className="min-w-0 max-w-full space-y-4">
      <div className="flex justify-end">
        <HolisticTutorialLink />
      </div>
      <AdminSelectors selectedProgramId={shownProgramId} availableProgramIds={orderedAvailableProgramIds}
        offerAllPrograms={offerAllPrograms} academicYear={academicYear} academicYears={academicYears}
        onProgramChange={handleProgramChange} onAcademicYearChange={setAcademicYear} />
      <WorkspaceTabs workspaces={workspaces} active={active} tabSetId={tabSetId}
        tabRefs={tabRefs} onActivate={chooseTab} onKeyDown={handleTabKeyDown} />
      <WorkspacePanel active={active} tabSetId={tabSetId} academicYear={academicYear}
        programId={selectedProgramId} heatmapProgramId={shownProgramId} canEdit={canEdit}
        onAcademicYears={updateAcademicYears} />
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
