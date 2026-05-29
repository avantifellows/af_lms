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
    <div data-testid="progress-summary" data-chapters={JSON.stringify(props.chapters)} />
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

function mockOkJson(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

function setupFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/curriculum/options?school_code=70705") {
      return mockOkJson(optionsResponse);
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

  it("renames History to Logs and disables Logs/Add Log until backend persistence exists", async () => {
    const user = userEvent.setup();
    renderTab({ canEdit: true });

    await screen.findByTestId("chapter-accordion");

    const addButton = screen.getByRole("button", { name: "+ Add Log" });
    expect(addButton).toBeDisabled();
    expect(screen.queryByText("History")).not.toBeInTheDocument();

    await user.click(screen.getByText("Logs"));

    expect(screen.getByText("Backend Logs are not available yet.")).toBeInTheDocument();
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
