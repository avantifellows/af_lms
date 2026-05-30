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
    canEdit?: boolean;
    onToggleChapterCompletion?: (id: number, completed: boolean) => void;
  }) => (
    <div data-testid="chapter-accordion" data-chapters={JSON.stringify(props.chapters)}>
      <button data-testid="toggle-chapter-1" onClick={() => props.onToggleChapter(1)}>
        Toggle
      </button>
      {props.canEdit && (
        <button
          onClick={() => props.onToggleChapterCompletion?.(1, true)}
        >
          Mark Chapter Row
        </button>
      )}
    </div>
  ),
}));

vi.mock("./SessionHistory", () => ({
  default: (props: {
    logs: Array<{ id: number; logDate: string; isEditable: boolean }>;
    canEdit?: boolean;
    onEditLog?: (log: { id: number; logDate: string; isEditable: boolean }) => void;
    onDeleteLog?: (log: { id: number; logDate: string; isEditable: boolean }) => void;
  }) => (
    <div data-testid="session-history" data-logs={JSON.stringify(props.logs)}>
      {props.logs.map((log) => (
        <div key={log.id}>
          <span>{log.logDate}</span>
          {props.canEdit && (
            <>
              <button
                disabled={!log.isEditable}
                onClick={() => props.onEditLog?.(log)}
              >
                Edit log {log.id}
              </button>
              <button onClick={() => props.onDeleteLog?.(log)}>
                Delete log {log.id}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./LogSessionModal", () => ({
  default: (props: {
    onSave: (payload: {
      date: string;
      durationMinutes: number;
      topicIds: number[];
      completeChapterIds: number[];
      uncompleteChapterIds: number[];
    }) => void;
    error?: string | null;
    isSaving?: boolean;
    editLog?: { id: number } | null;
  }) => (
    <div data-testid="log-session-modal">
      {props.editLog && <div>Editing log {props.editLog.id}</div>}
      {props.error && <div>{props.error}</div>}
      <button
        onClick={() =>
          props.onSave({
            date: "2026-02-15",
            durationMinutes: 90,
            topicIds: [101],
            completeChapterIds: [],
            uncompleteChapterIds: [],
          })
        }
        disabled={props.isSaving}
      >
        Save Mock Log
      </button>
      <button
        onClick={() =>
          props.onSave({
            date: "2026-02-15",
            durationMinutes: 0,
            topicIds: [],
            completeChapterIds: [1],
            uncompleteChapterIds: [],
          })
        }
        disabled={props.isSaving}
      >
        Save Completion Only
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
    if (url === "/api/curriculum/logs/10" && init?.method === "PATCH") {
      return mockOkJson({ log: logsResponse.logs[0] });
    }
    if (url === "/api/curriculum/logs/10" && init?.method === "DELETE") {
      return mockOkJson({ deleted: true });
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

  it("loads backend logs after reload even when browser localStorage is unavailable", async () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("localStorage unavailable");
      });

    renderTab({ schoolName: "Avanti School" });

    await screen.findByTestId("chapter-accordion");
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
      );
    });
    expect(getItemSpy).not.toHaveBeenCalled();
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
            complete_chapter_ids: [],
            uncomplete_chapter_ids: [],
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

  it("saves completion-only changes without log date or duration and refreshes progress", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByRole("button", { name: "+ Add Log" }));
    await user.click(screen.getByText("Save Completion Only"));

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
            topic_ids: [],
            complete_chapter_ids: [1],
            uncomplete_chapter_ids: [],
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

  it("saves edits through PATCH with no Chapter Completion fields and refreshes Logs and Progress", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Logs"));
    await user.click(screen.getByRole("button", { name: "Edit log 10" }));

    expect(screen.getByText("Editing log 10")).toBeInTheDocument();
    await user.click(screen.getByText("Save Mock Log"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/logs/10",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            log_date: "2026-02-15",
            duration_minutes: 90,
            topic_ids: [101],
          }),
        })
      );
    });
    const patchCall = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/curriculum/logs/10" && init?.method === "PATCH"
    );
    expect(patchCall?.[1]?.body).not.toContain("complete_chapter_ids");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
  });

  it("deletes a log through the backend and refreshes Logs and Progress", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Logs"));
    await user.click(screen.getByRole("button", { name: "Delete log 10" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/logs/10",
        expect.objectContaining({ method: "DELETE" })
      );
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
  });

  it("keeps the log row visible and shows an API error when delete fails", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/curriculum/logs/10" && init?.method === "DELETE") {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Delete failed" }) });
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
      return mockOkJson({ chapters: physicsChapters });
    });

    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Logs"));
    await user.click(screen.getByRole("button", { name: "Delete log 10" }));

    expect(await screen.findByText("Delete failed")).toBeInTheDocument();
    expect(screen.getByTestId("session-history")).toHaveAttribute(
      "data-logs",
      JSON.stringify(logsResponse.logs)
    );
  });

  it("shows reload guidance when DELETE is rejected after permissions change", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/curriculum/logs/10" && init?.method === "DELETE") {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
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
      return mockOkJson({ chapters: physicsChapters });
    });

    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Logs"));
    await user.click(screen.getByRole("button", { name: "Delete log 10" }));

    expect(
      await screen.findByText("Your permissions changed. Reload the page before trying again.")
    ).toBeInTheDocument();
  });

  it("hides log delete controls for read-only users", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: false });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Logs"));

    expect(screen.queryByRole("button", { name: "Delete log 10" })).not.toBeInTheDocument();
  });

  it("keeps the edit modal open with reload guidance when PATCH permission changes", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/curriculum/logs/10" && init?.method === "PATCH") {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
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
      return mockOkJson({ chapters: physicsChapters });
    });
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Logs"));
    await user.click(screen.getByRole("button", { name: "Edit log 10" }));
    await user.click(screen.getByText("Save Mock Log"));

    expect(
      await screen.findByText("Your permissions changed. Reload the page before trying again.")
    ).toBeInTheDocument();
    expect(screen.getByText("Editing log 10")).toBeInTheDocument();
  });

  it("marks completion from the chapter row through the dedicated endpoint and refreshes without creating a log", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Mark Chapter Row"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/curriculum/chapters/1/completion",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            school_code: "70705",
            program_id: 1,
            exam_track: "jee_main",
            grade: 11,
            subject: "Physics",
            completed: true,
          }),
        })
      );
    });
    expect(mockFetch).not.toHaveBeenCalledWith(
      "/api/curriculum/logs",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/logs?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/curriculum/progress?school_code=70705&program_id=1&exam_track=jee_main&grade=11&subject=Physics"
    );
  });

  it("shows reload guidance when chapter-row completion is rejected after permissions change", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/curriculum/chapters/1/completion" && init?.method === "PUT") {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
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
      return mockOkJson({ chapters: physicsChapters });
    });

    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByText("Mark Chapter Row"));

    expect(
      await screen.findByText("Your permissions changed. Reload the page before trying again.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
  });

  it("keeps the Add Log modal open with reload guidance when mutation permission changes", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/curriculum/logs" && init?.method === "POST") {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
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
      return mockOkJson({ chapters: physicsChapters });
    });
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");
    await user.click(screen.getByRole("button", { name: "+ Add Log" }));
    await user.click(screen.getByText("Save Completion Only"));

    expect(
      await screen.findByText("Your permissions changed. Reload the page before trying again.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("log-session-modal")).toBeInTheDocument();
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
