import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CurriculumTab from "./CurriculumTab";
import type { Chapter, ChapterProgress } from "@/types/curriculum";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./ProgressSummary", () => ({
  default: (props: { chapters: Chapter[]; progress: Record<number, ChapterProgress> }) => (
    <div
      data-testid="progress-summary"
      data-chapters={JSON.stringify(props.chapters)}
      data-progress={JSON.stringify(props.progress)}
    />
  ),
}));

vi.mock("./ChapterAccordion", () => ({
  default: (props: {
    chapters: Chapter[];
    progress: Record<number, ChapterProgress>;
    expandedChapterIds: number[];
    onToggleChapter: (id: number) => void;
  }) => (
    <div data-testid="chapter-accordion" data-chapters={JSON.stringify(props.chapters)}>
      <button data-testid="toggle-chapter-1" onClick={() => props.onToggleChapter(1)}>
        Toggle
      </button>
    </div>
  ),
}));

vi.mock("./SessionHistory", () => ({
  default: (props: { logs: Array<{ id: number; logDate: string }> }) => (
    <div data-testid="session-history" data-logs={JSON.stringify(props.logs)}>
      {props.logs.map((log) => (
        <div key={log.id}>{log.logDate}</div>
      ))}
    </div>
  ),
}));

vi.mock("./LogSessionModal", () => ({
  default: (props: {
    onSave: (date: string, durationMinutes: number, topicIds: number[]) => void;
    error?: string | null;
    isSaving?: boolean;
  }) => (
    <div data-testid="log-session-modal">
      {props.error && <div>{props.error}</div>}
      <button
        onClick={() => props.onSave("2026-02-15", 90, [101])}
        disabled={props.isSaving}
      >
        Save Mock Log
      </button>
    </div>
  ),
}));

const optionsResponse = {
  programs: [
    { id: 1, name: "JNV CoE" },
    { id: 2, name: "JNV Nodal" },
  ],
  examTracks: ["jee_main", "neet"],
  gradeSubjects: [
    { examTrack: "jee_main", grade: 11, gradeId: 3, subject: "Physics", subjectId: 4 },
    { examTrack: "neet", grade: 12, gradeId: 4, subject: "Biology", subjectId: 3 },
  ],
  defaults: {
    programId: 1,
    examTrack: "jee_main",
    grade: 11,
    gradeId: 3,
    subject: "Physics",
    subjectId: 4,
  },
};

const physicsChapters: Chapter[] = [
  {
    id: 1,
    code: "PH01",
    name: "Kinematics",
    grade: 11,
    subjectId: 4,
    subjectName: "Physics",
    examTrack: "jee_main",
    prescribedMinutes: 90,
    coverageSequence: 1,
    topics: [{ id: 101, code: "PH01.01", name: "Motion", chapterId: 1 }],
  },
];

const biologyChapters: Chapter[] = [
  {
    id: 2,
    code: "BIO01",
    name: "Plant Kingdom",
    grade: 12,
    subjectId: 3,
    subjectName: "Biology",
    examTrack: "neet",
    prescribedMinutes: 120,
    coverageSequence: 1,
    topics: [{ id: 201, code: "BIO01.01", name: "Algae", chapterId: 2 }],
  },
];

let mockFetch: ReturnType<typeof vi.fn>;
const progressResponse = {
  subjectTotalTimeMinutes: 90,
  progress: {
    1: {
      chapterId: 1,
      completedTopicIds: [101],
      totalTimeMinutes: 90,
      lastTaughtDate: "2026-02-15",
      allTopicsCovered: true,
      isChapterComplete: false,
      chapterCompletedDate: null,
    },
  },
};
const logsResponse = {
  logs: [
    {
      id: 10,
      logDate: "2026-02-15",
      durationMinutes: 90,
      programId: 1,
      gradeId: 3,
      subjectId: 4,
      examTrack: "jee_main",
      topics: [{ topicId: 101, topicName: "Motion", chapterId: 1, chapterName: "Kinematics" }],
      isEditable: true,
      createdAt: "2026-02-15T10:00:00.000Z",
      updatedAt: "2026-02-15T10:00:00.000Z",
    },
  ],
};

function mockOkJson(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

function setupFetch() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/curriculum/logs" && init?.method === "POST") {
      return mockOkJson({ log: logsResponse.logs[0] });
    }
    if (url === "/api/curriculum/options?school_code=70705") {
      return mockOkJson(optionsResponse);
    }
    if (url.includes("/api/curriculum/logs?")) {
      return mockOkJson(logsResponse);
    }
    if (url.includes("/api/curriculum/progress?")) {
      return mockOkJson(progressResponse);
    }
    if (url.includes("exam_track=neet")) {
      return mockOkJson({ chapters: biologyChapters });
    }
    return mockOkJson({ chapters: physicsChapters });
  });
}

function renderTab(props: Partial<{ schoolCode: string; schoolName: string; canEdit: boolean }> = {}) {
  return render(
    <CurriculumTab
      schoolCode={props.schoolCode ?? "70705"}
      schoolName={props.schoolName ?? "Test School"}
      canEdit={props.canEdit ?? true}
    />
  );
}

describe("CurriculumTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    setupFetch();
  });

  it("discovers backend options then fetches chapters for the default scope", async () => {
    renderTab({ schoolName: "Avanti School" });

    expect(await screen.findByText("JEE Main Curriculum Progress")).toBeInTheDocument();
    expect(screen.getByText("Avanti School")).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toBeInTheDocument();
    expect(screen.getByLabelText("Exam Track")).toBeInTheDocument();
    expect(screen.getByLabelText("Grade")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/curriculum/options?school_code=70705");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/chapters?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      );
    });

    const accordion = await screen.findByTestId("chapter-accordion");
    expect(JSON.parse(accordion.getAttribute("data-chapters") || "[]")).toEqual(physicsChapters);
  });

  it("filters grade and subject by selected Exam Track, including NEET Biology", async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByTestId("chapter-accordion");
    await user.selectOptions(screen.getByLabelText("Exam Track"), "neet");

    await waitFor(() => {
      expect(screen.getByLabelText("Grade")).toHaveValue("12");
      expect(screen.getByLabelText("Subject")).toHaveValue("Biology");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/chapters?school_code=70705&program_id=1&exam_track=neet&grade=12&subject=Biology"
      );
    });
  });

  it("shows backend Logs and opens the Add Log modal", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");

    const addButton = screen.getByRole("button", { name: "+ Add Log" });
    await waitFor(() => expect(addButton).not.toBeDisabled());
    expect(screen.queryByText("History")).not.toBeInTheDocument();

    await user.click(screen.getByText("Logs"));

    expect(screen.getByTestId("session-history")).toBeInTheDocument();
    expect(screen.getByText("2026-02-15")).toBeInTheDocument();

    await user.click(addButton);
    expect(screen.getByTestId("log-session-modal")).toBeInTheDocument();
  });

  it("saves a topic-backed log through the backend and refreshes Logs and Progress", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByRole("button", { name: "+ Add Log" }));
    await user.click(screen.getByText("Save Mock Log"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/logs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            school_code: "70705",
            program_id: 1,
            exam_track: "jee_main",
            grade: 11,
            subject: "Physics",
            log_date: "2026-02-15",
            duration_minutes: 90,
            topic_ids: [101],
          }),
        })
      );
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
  });

  it("shows an empty state when backend config is empty", async () => {
    mockFetch.mockResolvedValueOnce(
      await mockOkJson({
        ...optionsResponse,
        examTracks: [],
        gradeSubjects: [],
        defaults: {
          programId: 1,
          examTrack: null,
          grade: null,
          gradeId: null,
          subject: null,
          subjectId: null,
        },
      })
    );

    renderTab();

    expect(await screen.findByText("No Curriculum configuration is available for this school.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/curriculum/chapters"));
  });
});
