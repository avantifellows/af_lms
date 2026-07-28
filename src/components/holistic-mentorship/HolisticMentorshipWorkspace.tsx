"use client";

import { useCallback, useId, useRef, useState } from "react";

import { Select } from "@/components/ui";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS, PROGRAM_ID_TO_LABEL } from "@/lib/constants";
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

function nextWorkspaceIndex(key: string, index: number, count: number) {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

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

  if (mode === "teacher") {
    return schoolCode
      ? <TeacherMappingWorkspace schoolCode={schoolCode} canEdit={canEdit} />
      : null;
  }

  return (
    <section className="min-w-0 max-w-full space-y-4">
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
        {active.id === "phases" ? (
          <PhasePlanSetup academicYear={academicYear} />
        ) : (
          <ProgressWorkspace academicYear={academicYear} onAcademicYears={updateAcademicYears} />
        )}
      </div>
    </section>
  );
}
