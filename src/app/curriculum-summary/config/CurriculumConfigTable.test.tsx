import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import CurriculumConfigTable from "./CurriculumConfigTable";
import type { CurriculumConfigFilters, CurriculumConfigRow } from "@/lib/curriculum-config";

const baseFilters: CurriculumConfigFilters = {
  examTrack: "jee_main",
  grade: null,
  subject: null,
  search: "",
  syllabusStatus: "in_syllabus",
};

const inSyllabusRow: CurriculumConfigRow = {
  id: 42,
  chapterId: 7,
  chapterCode: "PHY-01",
  chapterName: "Motion",
  grade: 11,
  subjectId: 4,
  subjectName: "Physics",
  examTrack: "jee_main",
  isInSyllabus: true,
  syllabusStatus: "in_syllabus",
  prescribedMinutes: 0,
  prescribedHours: 0,
  prescribedHoursLabel: "0h",
  coverageSequence: 2,
  updatedByEmail: "admin@avantifellows.org",
  updatedAt: "2026-05-30T10:00:00.000Z",
};

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => body,
  } as Response;
}

describe("CurriculumConfigTable", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("opens an edit panel with read-only identity, impact counts, and warnings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          counts: {
            expectedSummaryRows: 12,
            activeCurriculumLogs: 3,
            activeChapterCompletions: 4,
          },
          warnings: [{ code: "duplicate_coverage_sequence", message: "Duplicate order" }],
        })
      )
    );

    render(<CurriculumConfigTable rows={[inSyllabusRow]} activeFilters={baseFilters} />);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("heading", { name: "Motion" })).toBeInTheDocument();
    expect(screen.getAllByText("Config ID")).toHaveLength(2);
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    expect(screen.getByText("Chapter ID")).toBeInTheDocument();
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Exam Track")).toHaveLength(2);
    expect(screen.getAllByText("JEE Main").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Prescribed minutes")).toHaveValue(0);
    expect(screen.getByLabelText("Coverage order")).toHaveValue(2);
    expect(
      screen.getByText("In-syllabus rows cannot be removed from syllabus in this edit flow.")
    ).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Summary rows")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Active logs")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Duplicate order")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This in-syllabus row has zero prescribed minutes and will still appear in Curriculum Summary."
      )
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Coverage order"), {
      target: { value: "3" },
    });

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
        expect.stringContaining("coverage_sequence=3")
      )
    );
  });

  it("shows stale conflict messaging from PATCH", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input, init) => {
        if (init?.method === "PATCH") {
          return Promise.resolve(
            jsonResponse(
              { error: "Curriculum Config row is stale" },
              { status: 409, ok: false }
            )
          );
        }
        return Promise.resolve(jsonResponse({ counts: null, warnings: [] }));
      })
    );

    render(<CurriculumConfigTable rows={[inSyllabusRow]} activeFilters={baseFilters} />);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This row changed since you opened it. Reload and reopen the row.")
    ).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("runs the Add flow with chapter filtering, topicless warning, impact, and hidden success", async () => {
    const createdRow: CurriculumConfigRow = {
      ...inSyllabusRow,
      id: 50,
      chapterId: 8,
      chapterCode: "PHY-02",
      chapterName: "Laws",
      coverageSequence: 3,
    };
    const fetchMock = vi.fn((input, init) => {
      const url = String(input);
      if (url.startsWith("/api/curriculum/configs/chapter-options")) {
        return Promise.resolve(
          jsonResponse({
            options: [
              {
                chapterId: 8,
                chapterCode: "PHY-02",
                chapterName: "Laws",
                grade: 11,
                subjectId: 4,
                subjectName: "Physics",
                topicCount: 0,
                hasTopics: false,
                topicWarning: "This chapter has no topics.",
                existingConfigId: null,
                configExists: false,
                existingIsInSyllabus: null,
              },
            ],
          })
        );
      }
      if (url.startsWith("/api/curriculum/configs/impact")) {
        return Promise.resolve(
          jsonResponse({
            counts: {
              expectedSummaryRows: 12,
              activeCurriculumLogs: 1,
              activeChapterCompletions: 2,
            },
            warnings: [{ code: "zero_prescribed_minutes", message: "Zero minutes" }],
          })
        );
      }
      if (url === "/api/curriculum/configs" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            row: createdRow,
            warnings: [],
            impact: {
              expectedSummaryRows: 12,
              activeCurriculumLogs: 1,
              activeChapterCompletions: 2,
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CurriculumConfigTable
        rows={[inSyllabusRow]}
        activeFilters={{ ...baseFilters, search: "motion" }}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      screen.getByRole("heading", { name: "Add LMS Chapter Exam Config" })
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/PHY-02/).length).toBeGreaterThan(0));
    expect(screen.getByText(/0 topics/)).toBeInTheDocument();
    expect(screen.getByText("This chapter has no topics.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Select PHY-02/ }));
    await waitFor(() => expect(screen.getByText("Summary rows")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Zero minutes")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Coverage order"));
    await userEvent.type(screen.getByLabelText("Coverage order"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("Curriculum Config row added but hidden by active filters.")
    ).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/curriculum/configs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"chapter_id":8'),
      })
    );
  });

  it("blocks out-of-syllabus duplicates and opens the restore edit flow", async () => {
    const outOfSyllabusRow: CurriculumConfigRow = {
      ...inSyllabusRow,
      id: 77,
      chapterId: 8,
      chapterCode: "PHY-02",
      chapterName: "Laws",
      isInSyllabus: false,
      syllabusStatus: "out_of_syllabus",
      prescribedMinutes: 0,
      prescribedHoursLabel: "0h",
    };
    const fetchMock = vi.fn((input) => {
      const url = String(input);
      if (url.startsWith("/api/curriculum/configs/chapter-options")) {
        return Promise.resolve(
          jsonResponse({
            options: [
              {
                chapterId: 8,
                chapterCode: "PHY-02",
                chapterName: "Laws",
                grade: 11,
                subjectId: 4,
                subjectName: "Physics",
                topicCount: 2,
                hasTopics: true,
                topicWarning: "",
                existingConfigId: 77,
                configExists: true,
                existingIsInSyllabus: false,
              },
            ],
          })
        );
      }
      if (url.startsWith("/api/curriculum/configs?")) {
        return Promise.resolve(jsonResponse({ rows: [outOfSyllabusRow] }));
      }
      if (url.startsWith("/api/curriculum/configs/impact")) {
        return Promise.resolve(jsonResponse({ counts: null, warnings: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CurriculumConfigTable rows={[inSyllabusRow]} activeFilters={baseFilters} />);

    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getAllByText(/PHY-02/).length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: /Select PHY-02/ }));

    expect(screen.getByText("A config row already exists for this chapter and Exam Track.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Open restore flow" }));

    expect(
      await screen.findByRole("heading", { name: "Laws" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Restore to in syllabus")).toBeInTheDocument();
  });

  it("refreshes the current filtered page and reports when a restored row is hidden", async () => {
    const outOfSyllabusRow: CurriculumConfigRow = {
      ...inSyllabusRow,
      isInSyllabus: false,
      syllabusStatus: "out_of_syllabus",
      prescribedMinutes: 0,
      prescribedHoursLabel: "0h",
    };
    const restoredRow: CurriculumConfigRow = {
      ...outOfSyllabusRow,
      isInSyllabus: true,
      syllabusStatus: "in_syllabus",
    };
    const fetchMock = vi.fn((input, init) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            row: restoredRow,
            warnings: [],
            impact: {
              expectedSummaryRows: 12,
              activeCurriculumLogs: 0,
              activeChapterCompletions: 0,
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({ counts: null, warnings: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CurriculumConfigTable
        rows={[outOfSyllabusRow]}
        activeFilters={{ ...baseFilters, syllabusStatus: "out_of_syllabus" }}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByLabelText("Restore to in syllabus"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Curriculum Config row saved but hidden by active filters.")
    ).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/curriculum/configs/42",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"is_in_syllabus":true'),
      })
    );
  });

  it("removes an in-syllabus row through a global-impact confirmation flow", async () => {
    const removedRow: CurriculumConfigRow = {
      ...inSyllabusRow,
      isInSyllabus: false,
      syllabusStatus: "out_of_syllabus",
      prescribedMinutes: 0,
      prescribedHoursLabel: "0h",
    };
    const fetchMock = vi.fn((input, init) => {
      const url = String(input);
      if (url.startsWith("/api/curriculum/configs/impact")) {
        return Promise.resolve(
          jsonResponse({
            counts: {
              expectedSummaryRows: 12,
              activeCurriculumLogs: 2,
              activeChapterCompletions: 5,
            },
            warnings: [],
          })
        );
      }
      if (
        url === "/api/curriculum/configs/42/remove-from-syllabus" &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({
            row: removedRow,
            warnings: [],
            impact: {
              expectedSummaryRows: 12,
              activeCurriculumLogs: 2,
              activeChapterCompletions: 5,
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CurriculumConfigTable rows={[inSyllabusRow]} activeFilters={baseFilters} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(
      screen.getByRole("heading", { name: "Remove from syllabus" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("PHY-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Motion").length).toBeGreaterThan(0);
    expect(screen.getAllByText("JEE Main").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "This global change removes the row from live Curriculum options and Curriculum Summary calculations without deleting historical LMS Curriculum Logs or Chapter Completion records."
      )
    ).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Summary rows")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Active logs")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText("Chapter completions")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove from syllabus" }));

    expect(
      await screen.findByText("Curriculum Config row removed but hidden by active filters.")
    ).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/curriculum/configs/42/remove-from-syllabus",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"updated_at":"2026-05-30T10:00:00.000Z"'),
      })
    );
  });

  it("does not expose remove on out-of-syllabus rows", () => {
    const outOfSyllabusRow: CurriculumConfigRow = {
      ...inSyllabusRow,
      isInSyllabus: false,
      syllabusStatus: "out_of_syllabus",
      prescribedMinutes: 0,
      prescribedHoursLabel: "0h",
    };
    vi.stubGlobal("fetch", vi.fn());

    render(
      <CurriculumConfigTable rows={[outOfSyllabusRow]} activeFilters={baseFilters} />
    );

    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows stale conflict messaging from remove-from-syllabus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input, init) => {
        if (init?.method === "POST") {
          return Promise.resolve(
            jsonResponse(
              { error: "Curriculum Config row is stale" },
              { status: 409, ok: false }
            )
          );
        }
        return Promise.resolve(jsonResponse({ counts: null, warnings: [] }));
      })
    );

    render(<CurriculumConfigTable rows={[inSyllabusRow]} activeFilters={baseFilters} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove from syllabus" }));

    expect(
      await screen.findByText("This row changed since you opened it. Reload and reopen the row.")
    ).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
