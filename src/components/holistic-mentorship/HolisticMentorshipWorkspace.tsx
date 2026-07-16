"use client";

import { ClipboardList, Users } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui";
import PhasePlanSetup from "./PhasePlanSetup";
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
}: {
  mode: WorkspaceMode;
  schoolCode?: string;
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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-border pb-3" role="tablist">
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            role="tab"
            aria-selected={workspace.id === active.id}
            onClick={() => {
              setActiveId(workspace.id);
              if (mode === "teacher" && schoolCode) {
                sessionStorage.setItem(`holistic-mappings-view:${schoolCode}`, workspace.id);
              }
            }}
            className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              workspace.id === active.id
                ? "bg-accent text-text-on-accent"
                : "bg-bg-card-alt text-text-secondary hover:bg-hover-bg hover:text-text-primary"
            }`}
          >
            {workspace.label}
          </button>
        ))}
      </div>

      {mode === "teacher" && schoolCode ? (
        <TeacherMappingWorkspace schoolCode={schoolCode} view={active.id as "assign" | "mentees"} />
      ) : mode === "admin" && active.id === "phases" ? (
        <PhasePlanSetup />
      ) : (
        <Card elevation="sm" className="flex min-h-48 flex-col items-center justify-center gap-3 border-dashed p-6 text-center">
          <Icon aria-hidden="true" className="h-7 w-7 text-text-muted" />
          <p className="text-sm font-medium text-text-muted">{active.empty}</p>
        </Card>
      )}
    </section>
  );
}
