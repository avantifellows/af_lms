import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StudentPhaseWorkspace from "./StudentPhaseWorkspace";

describe("StudentPhaseWorkspace", () => {
  it("renders live Context and stable Phase navigation without authoring controls", () => {
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={{
      student: { id: 41, name: "Asha Rao", externalStudentId: "S41", grade: 12 },
      phases: [
        { phaseId: 70, number: 4, title: "Building confidence", locked: false, active: false, progress: "completed", draftSaved: false, grade: 11, academicYear: "2025-2026" },
        { phaseId: 73, number: 5, title: "Next steps", locked: false, active: true, progress: "pending", draftSaved: false, grade: 12, academicYear: "2026-2027" },
      ],
      selectedPhase: {
        phaseId: 73, number: 5, title: "Next steps", locked: false, active: true,
        progress: "pending", draftSaved: false, grade: 12, academicYear: "2026-2027",
        guidanceMarkdown: "## Prepare\nListen first.",
        context: { label: "From Phase 4 - Building confidence", items: [{ label: "What helped?", content: "A weekly plan" }], lastUpdatedAt: "2026-05-03T00:00:00Z" },
        questions: [{ questionId: 91, text: "What will you try next?", position: 1 }],
        notes: null,
      },
      readOnly: false,
    }} />);

    expect(screen.getByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Phase 4/ })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027"
    );
    expect(screen.getByText("From Phase 4 - Building confidence")).toBeInTheDocument();
    expect(screen.getByText("A weekly plan")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
