import { render, screen, waitFor } from "@testing-library/react";
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
});
