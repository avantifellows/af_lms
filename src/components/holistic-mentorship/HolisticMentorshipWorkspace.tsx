"use client";

import { ClipboardList, Users } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui";
import PhasePlanSetup from "./PhasePlanSetup";

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

export default function HolisticMentorshipWorkspace({ mode }: { mode: WorkspaceMode }) {
  const workspaces = WORKSPACES[mode];
  const [activeId, setActiveId] = useState<string>(workspaces[0].id);
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
            onClick={() => setActiveId(workspace.id)}
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

      {mode === "admin" && active.id === "phases" ? (
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
