import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CycleCard from "./CycleCard";
import type { Cycle, CycleTeacher } from "./types";

function teacher(overrides: Partial<CycleTeacher> = {}): CycleTeacher {
  return {
    teacherName: "Indrani Khan",
    teacherOrder: 1,
    teacherId: "T1",
    quizId: "q1",
    status: "created",
    portalLink: "https://portal/q1",
    adminTestingLink: "https://quiz/q1",
    buildFailed: false,
    ...overrides,
  };
}

const CYCLE: Cycle = {
  setupRunId: "run-1",
  cycleLabel: "Sep 2026",
  centreName: "JNV Kurnool CoE",
  batchClassIds: ["B27", "B28"],
  batchClassNames: ["2027 Engineering", "2028 Engineering"],
  startTime: "2026-09-17 11:32:28",
  endTime: "2026-09-18 11:32:28",
  createdBy: "pm@avantifellows.org",
  createdAt: "2026-09-17 11:32:28",
  teachers: [
    teacher(),
    teacher({ teacherName: "Setup Failed", teacherOrder: 2, quizId: null, status: "failed", portalLink: "" }),
    teacher({ teacherName: "Build Failed", teacherOrder: 3, quizId: null, buildFailed: true, portalLink: "" }),
    teacher({ teacherName: "Still Building", teacherOrder: 4, quizId: null, portalLink: "" }),
  ],
};

const RESPONSES = {
  teachers: [
    {
      teacherName: "Indrani Khan",
      teacherOrder: 1,
      responded: 36,
      total: 41,
      outsideBatches: 2,
      responseCount: 38,
      percentage: 95.5,
      notResponded: [{ name: "Anil", studentId: "S1", batchId: "B28" }],
    },
  ],
};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function renderCard(props: Partial<Parameters<typeof CycleCard>[0]> = {}) {
  const handlers = { onAnalyze: vi.fn(), onCopy: vi.fn(), onExtended: vi.fn() };
  render(<CycleCard cycle={CYCLE} canEdit focused={false} {...handlers} {...props} />);
  return handlers;
}

const open = () => fireEvent.click(screen.getByRole("button", { name: /Sep 2026/ }));

let extendResponse: () => Promise<Response>;

beforeEach(() => {
  extendResponse = () => json({ success: true, endTime: "2030-01-01T00:00:00.000Z" });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => (input.endsWith("/extend") ? extendResponse() : json(RESPONSES)))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CycleCard", () => {
  it("names the round's batches in the header and loads nothing until opened", () => {
    renderCard();

    expect(screen.getByText("2027 Engineering, 2028 Engineering")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows one box per teacher with score, responses and pending students", async () => {
    const { onAnalyze } = renderCard();
    open();

    expect(await screen.findByText("96%")).toBeInTheDocument();
    expect(screen.getByText("+2 from outside these batches")).toBeInTheDocument();
    // The round has ended, so nobody is "pending" any more.
    fireEvent.click(screen.getByRole("button", { name: /responded · 1 didn’t respond/ }));
    expect(screen.getByText("Anil")).toBeInTheDocument();
    expect(screen.getByText(/S1 · B28/)).toBeInTheDocument();

    const [analysis] = screen.getAllByRole("button", { name: "View analysis" });
    fireEvent.click(analysis);
    expect(onAnalyze).toHaveBeenCalledWith("q1", "Indrani Khan");
  });

  it("explains teachers whose form isn't usable", () => {
    renderCard();
    open();

    expect(screen.getByText("Setup failed")).toBeInTheDocument();
    expect(screen.getByText("Quiz build failed")).toBeInTheDocument();
    expect(screen.getByText("Generating links…")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View analysis" })[1]).toBeDisabled();
  });

  it("says so when responses can't be loaded", async () => {
    vi.mocked(fetch).mockImplementation(() => json({ error: "x" }, 500));
    renderCard();
    open();

    expect(await screen.findByText("Couldn’t load who has responded.")).toBeInTheDocument();
  });

  it("extends the round and reports back", async () => {
    const { onExtended } = renderCard();
    open();
    fireEvent.change(document.querySelector('input[type="datetime-local"]')!, {
      target: { value: "2030-01-01T05:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));

    await waitFor(() => expect(onExtended).toHaveBeenCalledWith(expect.stringContaining("Extended to"), "success"));
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/extend"))!;
    expect(JSON.parse(String(init!.body)).endTime).toBe(new Date("2030-01-01T05:30").toISOString());
  });

  it("refuses an end time that isn't later, and surfaces server errors", async () => {
    const { onExtended } = renderCard();
    open();
    const input = document.querySelector('input[type="datetime-local"]')!;
    fireEvent.change(input, { target: { value: "2020-01-01T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    expect(screen.getByText("Pick a time after the current end.")).toBeInTheDocument();

    extendResponse = () => json({ error: "New end time must be after the current end" }, 400);
    fireEvent.change(input, { target: { value: "2030-01-01T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    expect(await screen.findByText("New end time must be after the current end")).toBeInTheDocument();

    extendResponse = () => Promise.reject(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    expect(await screen.findByText("Extend request failed")).toBeInTheDocument();
    expect(onExtended).not.toHaveBeenCalled();
  });

  it("refreshes after a partial extend", async () => {
    extendResponse = () => json({ error: "Could not extend for: Ravi. Others were extended." }, 502);
    const { onExtended } = renderCard();
    open();
    fireEvent.change(document.querySelector('input[type="datetime-local"]')!, {
      target: { value: "2030-01-01T00:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));

    await waitFor(() =>
      expect(onExtended).toHaveBeenCalledWith("Could not extend for: Ravi. Others were extended.", "info")
    );
  });

  it("hides Extend from view-only users", () => {
    renderCard({ canEdit: false });
    open();
    expect(screen.queryByRole("button", { name: "Extend" })).not.toBeInTheDocument();
  });

  it("opens and scrolls to a round the setup nudge pointed at", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderCard({ focused: true });

    expect(screen.getByText("Indrani Khan")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
