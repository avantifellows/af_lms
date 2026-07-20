"use client";

import { ClipboardList, Users } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { Card, Select } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS, PROGRAM_ID_TO_LABEL } from "@/lib/constants";
import PhasePlanSetup from "./PhasePlanSetup";
import ProgressWorkspace from "./ProgressWorkspace";
import TeacherMappingWorkspace from "./TeacherMappingWorkspace";

type WorkspaceMode = "teacher" | "admin";

const [currentStartYear] = CURRENT_ACADEMIC_YEAR.split("-").map(Number);
const PRIOR_ACADEMIC_YEAR = `${currentStartYear - 1}-${currentStartYear}`;

const WORKSPACES = {
  admin: [
    { id: "progress", label: "Students & Progress", empty: "No mapped Students to show yet.", icon: Users },
    { id: "phases", label: "Phase Setup", empty: "No Holistic Phases configured yet.", icon: ClipboardList },
  ],
} as const;

export default function HolisticMentorshipWorkspace({
  mode,
  schoolCode,
  canEdit = true,
}: {
  mode: WorkspaceMode;
  schoolCode?: string;
  canEdit?: boolean;
}) {
  const workspaces = WORKSPACES.admin;
  const [activeId, setActiveId] = useState<string>(workspaces[0].id);
  const active = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];
  const Icon = active.icon;
  const tabSetId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [academicYear, setAcademicYear] = useState(CURRENT_ACADEMIC_YEAR);
  const [academicYears, setAcademicYears] = useState<string[]>([CURRENT_ACADEMIC_YEAR, PRIOR_ACADEMIC_YEAR]);
  const mergeAcademicYears = useCallback((years: string[]) => {
    if (years.length === 0) return;
    setAcademicYears((current) => {
      const merged = Array.from(new Set([...years, PRIOR_ACADEMIC_YEAR]));
      return merged.length === current.length && merged.every((year, index) => year === current[index])
        ? current
        : merged;
    });
  }, []);

  const activateWorkspace = (workspaceId: string) => {
    setActiveId(workspaceId);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % workspaces.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + workspaces.length) % workspaces.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = workspaces.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    activateWorkspace(workspaces[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  if (mode === "teacher") {
    return schoolCode
      ? <TeacherMappingWorkspace schoolCode={schoolCode} canEdit={canEdit} />
      : null;
  }

  return (
    <section className="min-w-0 max-w-full space-y-4">
      {mode === "admin" && (
        <div className="grid gap-3 rounded-md border border-border bg-bg-card p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            Program
            <Select aria-label="Program" className="mt-1 w-full font-normal normal-case tracking-normal" value={PROGRAM_IDS.COE} disabled>
              <option value={PROGRAM_IDS.COE}>{PROGRAM_IDS.COE} - {PROGRAM_ID_TO_LABEL[PROGRAM_IDS.COE]}</option>
            </Select>
          </label>
          <label className="block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            Academic Year
            <Select aria-label="Academic Year" className="mt-1 w-full font-mono font-normal normal-case tracking-normal"
              value={academicYear} onChange={(event) => setAcademicYear(event.target.value)}>
              {academicYears.map((year) => <option key={year}>{year}</option>)}
            </Select>
          </label>
        </div>
      )}
      <div
        aria-label="Holistic Mentorship sections"
        className="flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
      >
        {workspaces.map((workspace, index) => (
          <button
            key={workspace.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            id={`${tabSetId}-${workspace.id}-tab`}
            type="button"
            role="tab"
            aria-selected={workspace.id === active.id}
            aria-controls={`${tabSetId}-panel`}
            tabIndex={workspace.id === active.id ? 0 : -1}
            onClick={() => activateWorkspace(workspace.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            className={`-mb-px min-h-12 shrink-0 border-b-2 px-4 text-xs font-extrabold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 ${
              workspace.id === active.id
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:bg-accent/5 hover:text-text-primary"
            }`}
          >
            {workspace.label}
          </button>
        ))}
      </div>

      <div
        id={`${tabSetId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabSetId}-${active.id}-tab`}
        tabIndex={0}
        className="min-w-0 max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {mode === "admin" && active.id === "phases" ? (
          <PhasePlanSetup academicYear={academicYear} />
        ) : mode === "admin" && active.id === "progress" ? (
          <ProgressWorkspace academicYear={academicYear} onAcademicYears={mergeAcademicYears} />
        ) : (
          <Card elevation="sm" className="flex min-h-48 flex-col items-center justify-center gap-3 border-dashed p-6 text-center">
            <Icon aria-hidden="true" className="h-7 w-7 text-text-muted" />
            <p className="text-sm font-medium text-text-muted">{active.empty}</p>
          </Card>
        )}
      </div>
    </section>
  );
}
