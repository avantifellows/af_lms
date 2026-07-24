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

  it("keeps Historical notes as the later-Phase fallback until submitted Notes exist", () => {
    const input = {
      targetPhaseId: 26,
      phases: [
        { id: 25, number: 5, title: "Grade 12 start" },
        { id: 26, number: 6, title: "Following up" },
      ],
      profile: [{ title: "Strengths", summary: "Patient problem solver" }],
      historicalAnswers: [
        { question: "Historical question 1", answer: "Historical answer" },
        { question: "Historical question 2", answer: null },
        { question: "Historical question 3", answer: null },
        { question: "Historical question 4", answer: null },
      ],
      launchGrade12: true,
      entryGradeFirstPhaseId: 25,
    };

    expect(resolveHolisticStudentContext({ ...input, submittedNotes: [] })).toMatchObject({
      label: "Historical notes",
      items: [
        { label: "Historical question 1", content: "Historical answer" },
        { label: "Historical question 2", content: "No response recorded" },
        { label: "Historical question 3", content: "No response recorded" },
        { label: "Historical question 4", content: "No response recorded" },
      ],
    });

    expect(resolveHolisticStudentContext({
      ...input,
      submittedNotes: [{
        phaseId: 25,
        lastEditedAt: "2026-08-01T00:00:00Z",
        answers: [{ question: "What helped?", answer: "A weekly plan" }],
      }],
    })).toEqual({
      label: "From Phase 5 - Grade 12 start",
      items: [{ label: "What helped?", content: "A weekly plan" }],
      lastUpdatedAt: "2026-08-01T00:00:00Z",
    });
  });

  it("uses the Profile at launch Grade 12 entry when Historical answers are empty", () => {
    expect(resolveHolisticStudentContext({
      targetPhaseId: 25,
      phases: [{ id: 25, number: 5, title: "Grade 12 start" }],
      submittedNotes: [],
      profile: [{ title: "Strengths", summary: "Patient problem solver" }],
      historicalAnswers: [
        { question: "Historical question 1", answer: null },
        { question: "Historical question 2", answer: "  " },
        { question: "Historical question 3", answer: null },
        { question: "Historical question 4", answer: null },
      ],
      launchGrade12: true,
      entryGradeFirstPhaseId: 25,
    })).toEqual({
      label: "Student Profile",
      items: [{ label: "Strengths", content: "Patient problem solver" }],
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

  it("does not move a Grade 11 Profile to Grade 12 when prior-year Phases are unavailable", () => {
    expect(resolveHolisticStudentContext({
      targetPhaseId: 25,
      phases: [{ id: 25, number: 5, title: "Grade 12 start" }],
      submittedNotes: [],
      profile: [{ title: "Strengths", summary: "Patient problem solver" }],
      historicalAnswers: null,
      launchGrade12: false,
      entryGradeFirstPhaseId: null,
    })).toEqual({
      label: null,
      items: [],
      missing: "No previous session notes available",
    });
  });

  it("shows Profile unavailable only at an entry Phase without an Active Profile", () => {
    const input = {
      phases: [
        { id: 11, number: 1, title: "Starting out" },
        { id: 12, number: 2, title: "Following up" },
      ],
      submittedNotes: [],
      profile: null,
      historicalAnswers: null,
      launchGrade12: false,
      entryGradeFirstPhaseId: 11,
    };

    expect(resolveHolisticStudentContext({ ...input, targetPhaseId: 11 })).toEqual({
      label: null,
      items: [],
      missing: "Profile unavailable",
    });
    expect(resolveHolisticStudentContext({ ...input, targetPhaseId: 12 })).toEqual({
      label: null,
      items: [],
      missing: "No previous session notes available",
    });
  });

  it("does not treat a Grade 11 entrant with a missing prior Mapping as launch Grade 12", async () => {
    mockQuery
      .mockResolvedValueOnce([{
        student_id: 41, mapping_id: 301, name: "Asha", external_student_id: "S41",
        grade: 12, entry_grade: 11,
      }])
      .mockResolvedValueOnce([{
        id: 75, academic_year: "2026-2027", grade: 12, title: "Grade 12 start",
        position: 5, revision: 1, state: "open", guidance_markdown: "Listen first.",
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ academic_year: "2026-2027", started_at: "2026-07-01T00:00:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { title: "Strengths", summary: "Patient problem solver", position: 1 },
      ])
      .mockResolvedValueOnce([
        { question: "Historical question 1", answer: "Historical answer", position: 1 },
      ]);

    const result = await getHolisticStudentPhase({
      studentId: 41,
      phaseId: 75,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 10,
      role: "teacher",
      canEdit: true,
    });

    const [mappingSql, mappingParams] = mockQuery.mock.calls[0];
    expect(String(mappingSql)).toContain("FROM centre_students roster_student");
    expect(String(mappingSql)).toContain("roster_centre.school_id = mapping.school_id");
    expect(String(mappingSql)).toContain("current_roster ON mapping.academic_year = $5");
    expect(String(mappingSql)).not.toContain("batch_enrollment");
    expect(mappingParams).toEqual([41, 4, 1, "2026-2027", "2026-2027"]);

    expect(result).toMatchObject({
      selectedPhase: {
        context: {
          label: null,
          items: [],
          missing: "No previous session notes available",
        },
      },
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
      canEdit: true,
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
      .mockResolvedValueOnce([{
        title: "Strengths", summary: "Patient problem solver", position: 1,
        regeneration_request_key: "request-1", regeneration_state: "failed",
        regeneration_error_code: "no_questionnaire_submission",
      }])
      .mockResolvedValueOnce([]);

    const result = await getHolisticStudentPhase({
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      role: "holistic_mentorship_admin",
      canEdit: true,
    });

    expect(result).toMatchObject({
      readOnly: true,
      selectedPhase: {
        canEditNotes: false,
        draftSaved: true,
        context: {
          label: "Student Profile",
          items: [{ label: "Strengths", content: "Patient problem solver" }],
          regeneration: {
            requestKey: "request-1",
            state: "failed",
            errorCode: "no_questionnaire_submission",
          },
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

  it("opens an ended prior-year Mapping read-only with submitted Notes for Admin", async () => {
    mockQuery
      .mockResolvedValueOnce([{
        student_id: 41, mapping_id: 301, name: "Asha", external_student_id: "S41",
        grade: 11, entry_grade: 11,
      }])
      .mockResolvedValueOnce([{
        id: 63, academic_year: "2025-2026", grade: 11, title: "Looking ahead",
        position: 4, revision: 3, state: "open", guidance_markdown: "Reflect together.",
      }])
      .mockResolvedValueOnce([{
        id: 81, phase_id: 63, text: "What helped?", position: 1,
      }])
      .mockResolvedValueOnce([{
        phase_id: 63, to_state: "open", occurred_at: "2026-02-01T00:00:00Z",
      }])
      .mockResolvedValueOnce([{
        academic_year: "2025-2026", started_at: "2026-01-01T00:00:00Z",
      }])
      .mockResolvedValueOnce([{
        notes_id: 101, phase_id: 63, author_user_id: 9, author_name: "Divya Rao",
        state: "submitted", revision: 2, first_submitted_at: "2026-03-01T00:00:00Z",
        last_edited_at: "2026-03-02T00:00:00Z", question_id: 81,
        question: "What helped?", question_position: 1, answer: "A weekly plan",
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getHolisticStudentPhase({
      studentId: 41,
      phaseId: 63,
      schoolId: 4,
      academicYear: "2025-2026",
      role: "holistic_mentorship_admin",
      canEdit: true,
    });

    const [mappingSql, mappingParams] = mockQuery.mock.calls[0];
    expect(String(mappingSql)).toContain("($4 <> $5 OR mapping.ended_at IS NULL)");
    expect(String(mappingSql)).toContain("historical_enrollment.academic_year = mapping.academic_year");
    expect(String(mappingSql)).toContain("historical_grade ON mapping.academic_year <> $5");
    expect(String(mappingSql)).not.toContain("historical_enrollment.is_current IS TRUE");
    expect(String(mappingSql)).not.toContain("JOIN group_user");
    expect(String(mappingSql)).toContain("ORDER BY mapping.started_at DESC, mapping.id DESC");
    expect(mappingParams).toEqual([41, 4, 1, "2025-2026", "2026-2027"]);
    expect(result).toMatchObject({
      readOnly: true,
      selectedPhase: {
        phaseId: 63,
        canEditNotes: false,
        notes: {
          state: "submitted",
          authorName: "Divya Rao",
          answers: [{ questionId: 81, question: "What helped?", answer: "A weekly plan" }],
        },
      },
    });
  });

  it("shows an erased draft as a blank editable form to the replacement Mentor", async () => {
    mockQuery
      .mockResolvedValueOnce([{ student_id: 41, mapping_id: 301, name: "Asha", external_student_id: "S41", grade: 11, entry_grade: 11 }])
      .mockResolvedValueOnce([{ id: 73, academic_year: "2026-2027", grade: 11, title: "Getting started", position: 1, revision: 5, state: "open", guidance_markdown: "Listen first." }])
      .mockResolvedValueOnce([{ id: 91, phase_id: 73, text: "What helped?", position: 1 }])
      .mockResolvedValueOnce([{ phase_id: 73, to_state: "open", occurred_at: "2026-06-01T00:00:00Z" }])
      .mockResolvedValueOnce([{ academic_year: "2026-2027", started_at: "2026-07-01T00:00:00Z" }])
      .mockResolvedValueOnce([{
        notes_id: 101, phase_id: 73, author_user_id: 9, state: "draft", revision: 4,
        first_submitted_at: null, last_edited_at: "2026-07-02T00:00:00Z",
        question_id: null, question: null, question_position: null, answer: null,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getHolisticStudentPhase({
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 10,
      role: "teacher",
      canEdit: true,
    });

    expect(result).toMatchObject({
      readOnly: false,
      selectedPhase: {
        draftSaved: false,
        notesRevision: 4,
        canEditNotes: true,
        notes: null,
      },
    });
  });

  it("keeps a read-only Teacher's Notes controls read-only", async () => {
    mockQuery
      .mockResolvedValueOnce([{ student_id: 41, mapping_id: 301, name: "Asha", external_student_id: "S41", grade: 11, entry_grade: 11 }])
      .mockResolvedValueOnce([{ id: 73, academic_year: "2026-2027", grade: 11, title: "Getting started", position: 1, revision: 5, state: "open", guidance_markdown: "Listen first." }])
      .mockResolvedValueOnce([{ id: 91, phase_id: 73, text: "What helped?", position: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ academic_year: "2026-2027", started_at: "2026-07-01T00:00:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getHolisticStudentPhase({
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 10,
      role: "teacher",
      canEdit: false,
    });

    expect(result).toMatchObject({
      readOnly: true,
      selectedPhase: { canEditNotes: false },
    });
  });
});
