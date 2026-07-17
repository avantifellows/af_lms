"use client";

import { ClipboardList, Users } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Card } from "@/components/ui";
import PhasePlanSetup from "./PhasePlanSetup";
import ProgressWorkspace from "./ProgressWorkspace";
import TeacherMappingWorkspace from "./TeacherMappingWorkspace";

type WorkspaceMode = "teacher" | "admin";

const WORKSPACES = {
  teacher: [
    { id: "assign", label: "Assign Students", empty: "No eligible Students to show yet.", icon: Users },
    { id: "mentees", label: "My Mentees", empty: "No Mentees assigned yet.", icon: ClipboardList },
  ],
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
  const workspaces = WORKSPACES[mode];
  const [activeId, setActiveId] = useState<string>(() => {
    if (mode !== "teacher" || !schoolCode || typeof window === "undefined") {
      return workspaces[0].id;
    }
    const saved = sessionStorage.getItem(`holistic-mappings-view:${schoolCode}`);
    return workspaces.some((workspace) => workspace.id === saved)
      ? saved!
      : workspaces[0].id;
  });
  const active = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];
  const Icon = active.icon;
  const tabSetId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activateWorkspace = (workspaceId: string) => {
    setActiveId(workspaceId);
    if (mode === "teacher" && schoolCode) {
      sessionStorage.setItem(`holistic-mappings-view:${schoolCode}`, workspaceId);
    }
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

  return (
    <section className="min-w-0 max-w-full space-y-4">
      <div
        aria-label="Holistic Mentorship sections"
        className="flex gap-2 overflow-x-auto border-b border-border pb-3"
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
            className={`min-h-11 shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 ${
              workspace.id === active.id
                ? "bg-accent text-text-on-accent"
                : "bg-bg-card-alt text-text-secondary hover:bg-hover-bg hover:text-text-primary"
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
        {mode === "teacher" && schoolCode ? (
          <TeacherMappingWorkspace
            schoolCode={schoolCode}
            view={active.id as "assign" | "mentees"}
            canEdit={canEdit}
          />
        ) : mode === "admin" && active.id === "phases" ? (
          <PhasePlanSetup />
        ) : mode === "admin" && active.id === "progress" ? (
          <ProgressWorkspace />
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
