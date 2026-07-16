import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("./db", () => ({ query: mockQuery }));

import {
  buildHolisticApplicablePhases,
  deriveHolisticPhaseProgress,
  getHolisticStudentPhase,
  resolveHolisticStudentContext,
} from "./holistic-student-phase";

describe("Holistic Student Phase derivation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips only Phases before the Active Phase at the first Mapping", () => {
    const phases = [
      { id: 11, position: 1, transitions: [{ toState: "open" as const, occurredAt: "2026-06-01T00:00:00Z" }] },
      { id: 12, position: 2, transitions: [{ toState: "open" as const, occurredAt: "2026-06-05T00:00:00Z" }] },
      { id: 13, position: 3, transitions: [{ toState: "open" as const, occurredAt: "2026-07-01T00:00:00Z" }] },
    ];

    expect(
      deriveHolisticPhaseProgress(phases, "2026-06-10T00:00:00Z", [])
    ).toEqual(new Map([[11, "skipped"], [12, "pending"], [13, "pending"]]));
  });

  it("does not create initial skips when no Phase was Active", () => {
    expect(deriveHolisticPhaseProgress([
      { id: 11, position: 1, transitions: [] },
      { id: 12, position: 2, transitions: [] },
    ], "2026-06-10T00:00:00Z", [])).toEqual(new Map([[11, "pending"], [12, "pending"]]));
  });

  it("does not retroactively skip work when a later Phase opens", () => {
    expect(deriveHolisticPhaseProgress([
      { id: 11, position: 1, transitions: [{ toState: "open", occurredAt: "2026-06-01T00:00:00Z" }] },
      { id: 12, position: 2, transitions: [{ toState: "open", occurredAt: "2026-07-01T00:00:00Z" }] },
    ], "2026-06-10T00:00:00Z", [])).toEqual(new Map([[11, "pending"], [12, "pending"]]));
  });

  it("derives draft as Pending and submitted Notes as Completed", () => {
    expect(deriveHolisticPhaseProgress([
      { id: 11, position: 1, transitions: [{ toState: "open", occurredAt: "2026-06-01T00:00:00Z" }] },
      { id: 12, position: 2, transitions: [{ toState: "open", occurredAt: "2026-06-05T00:00:00Z" }] },
    ], "2026-06-10T00:00:00Z", [
      { phaseId: 11, state: "draft" },
      { phaseId: 12, state: "submitted" },
    ])).toEqual(new Map([[11, "pending"], [12, "completed"]]));
  });

  it("uses the latest earlier submitted Notes across Phase and year gaps", () => {
    const context = resolveHolisticStudentContext({
      targetPhaseId: 15,
      phases: [
        { id: 11, number: 1, title: "Starting out" },
        { id: 13, number: 3, title: "Building confidence" },
        { id: 15, number: 5, title: "Next steps" },
      ],
      submittedNotes: [{
        phaseId: 13,
        lastEditedAt: "2026-05-03T00:00:00Z",
        answers: [
          { question: "What helped?", answer: "A weekly study plan" },
          { question: "What is next?", answer: "Ask for feedback" },
        ],
      }],
      profile: null,
      historicalAnswers: null,
      launchGrade12: false,
      entryGradeFirstPhaseId: 11,
    });

    expect(context).toEqual({
      label: "From Phase 3 - Building confidence",
      items: [
        { label: "What helped?", content: "A weekly study plan" },
        { label: "What is next?", content: "Ask for feedback" },
      ],
      lastUpdatedAt: "2026-05-03T00:00:00Z",
    });
  });

  it("shows launch Grade 12 placeholders before real Phase 5", () => {
    expect(buildHolisticApplicablePhases({
      currentGrade: 12,
      entryGrade: 12,
      hasPriorYearMapping: false,
      currentPhases: [
        { id: 21, number: 1, grade: 11 as const, title: "Grade 11 start" },
        { id: 25, number: 5, grade: 12 as const, title: "Grade 12 start" },
      ],
      priorGrade11Phases: [],
    })).toEqual([
      { phaseId: null, number: 1, title: "Phase 1", placeholder: true },
      { phaseId: null, number: 2, title: "Phase 2", placeholder: true },
      { phaseId: null, number: 3, title: "Phase 3", placeholder: true },
      { phaseId: null, number: 4, title: "Phase 4", placeholder: true },
      { id: 25, number: 5, grade: 12, title: "Grade 12 start" },
    ]);
  });

  it("shows real prior-year Grade 11 history for a continuing Grade 12 Mentee", () => {
    expect(buildHolisticApplicablePhases({
      currentGrade: 12,
      entryGrade: 11,
      hasPriorYearMapping: true,
      currentPhases: [{ id: 25, number: 5, grade: 12 as const, title: "Grade 12 start" }],
      priorGrade11Phases: [{ id: 14, number: 4, grade: 11 as const, title: "Grade 11 close" }],
    })).toEqual([
      { id: 14, number: 4, grade: 11, title: "Grade 11 close" },
      { id: 25, number: 5, grade: 12, title: "Grade 12 start" },
    ]);
  });

  it("uses substantive Historical notes before Profile and preserves missing answers", () => {
    expect(resolveHolisticStudentContext({
      targetPhaseId: 25,
      phases: [{ id: 25, number: 5, title: "Grade 12 start" }],
      submittedNotes: [],
      profile: [{ title: "Strengths", summary: "Patient problem solver" }],
      historicalAnswers: [
        { question: "What worked?", answer: "Peer study" },
        { question: "What was difficult?", answer: null },
      ],
      launchGrade12: true,
      entryGradeFirstPhaseId: 25,
    })).toEqual({
      label: "Historical notes",
      items: [
        { label: "What worked?", content: "Peer study" },
        { label: "What was difficult?", content: "No response recorded" },
      ],
    });
  });

  it("uses the Active-configuration Profile only at the entry Grade's first Phase", () => {
    const input = {
      phases: [
        { id: 11, number: 1, title: "Starting out" },
        { id: 12, number: 2, title: "Following up" },
      ],
      submittedNotes: [],
      profile: [{ title: "Strengths", summary: "Patient problem solver" }],
      historicalAnswers: null,
      launchGrade12: false,
      entryGradeFirstPhaseId: 11,
    };
    expect(resolveHolisticStudentContext({ ...input, targetPhaseId: 11 })).toEqual({
      label: "Student Profile",
      items: [{ label: "Strengths", content: "Patient problem solver" }],
    });
    expect(resolveHolisticStudentContext({ ...input, targetPhaseId: 12 })).toEqual({
      label: null,
      items: [],
      missing: "No previous session notes available",
    });
  });

  it("does not expose protected content for an applicable Locked Phase", async () => {
    mockQuery
      .mockResolvedValueOnce([{ student_id: 41, name: "Asha", external_student_id: "S41", grade: 11, entry_grade: 11 }])
      .mockResolvedValueOnce([{ id: 73, academic_year: "2026-2027", grade: 11, title: "Getting started", position: 1, state: "locked", guidance_markdown: "secret" }])
      .mockResolvedValueOnce([{ id: 91, phase_id: 73, text: "secret question", position: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ academic_year: "2026-2027", started_at: "2026-07-01T00:00:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(getHolisticStudentPhase({
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      role: "teacher",
    })).resolves.toEqual({
      student: { id: 41, name: "Asha", externalStudentId: "S41", grade: 11 },
      phases: [{ phaseId: 73, number: 1, title: "Getting started", locked: true }],
      selectedPhase: { phaseId: 73, number: 1, title: "Getting started", locked: true },
      readOnly: false,
    });
  });

  it("keeps draft content private from Admin read-only drill-down", async () => {
    mockQuery
      .mockResolvedValueOnce([{ student_id: 41, name: "Asha", external_student_id: "S41", grade: 11, entry_grade: 11 }])
      .mockResolvedValueOnce([{ id: 73, academic_year: "2026-2027", grade: 11, title: "Getting started", position: 1, state: "open", guidance_markdown: "Listen first." }])
      .mockResolvedValueOnce([{ id: 91, phase_id: 73, text: "What helped?", position: 1 }])
      .mockResolvedValueOnce([{ phase_id: 73, to_state: "open", occurred_at: "2026-06-01T00:00:00Z" }])
      .mockResolvedValueOnce([{ academic_year: "2026-2027", started_at: "2026-07-01T00:00:00Z" }])
      .mockResolvedValueOnce([{
        notes_id: 101, phase_id: 73, author_user_id: 9, state: "draft", revision: 2,
        first_submitted_at: null, last_edited_at: "2026-07-02T00:00:00Z",
        question_id: 91, question: "What helped?", question_position: 1, answer: "private draft",
      }])
      .mockResolvedValueOnce([{ title: "Strengths", summary: "Patient problem solver", position: 1 }])
      .mockResolvedValueOnce([]);

    const result = await getHolisticStudentPhase({
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      role: "holistic_mentorship_admin",
    });

    expect(result).toMatchObject({
      readOnly: true,
      selectedPhase: {
        draftSaved: true,
        context: {
          label: "Student Profile",
          items: [{ label: "Strengths", content: "Patient problem solver" }],
        },
        notes: {
          state: "draft",
          revision: 2,
          firstSubmittedAt: null,
          lastEditedAt: "2026-07-02T00:00:00Z",
        },
      },
    });
    expect(result?.selectedPhase).not.toHaveProperty("notes.answers");
  });
});
