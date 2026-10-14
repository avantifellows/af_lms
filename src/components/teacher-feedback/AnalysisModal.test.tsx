import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AnalysisModal, { batchHistory, previousRound, type ReportData } from "./AnalysisModal";

const summary = (percentage: number, responseCount = 10) => ({
  responseCount,
  percentage,
  parameters: [{ parameter: "Curiosity", percentage, answeredBy: responseCount }],
});

function history(quizId: string, cycleLabel: string, batch: string, percentage: number) {
  return { ...summary(percentage), quizId, cycleLabel, startTime: null, batchNames: [batch] };
}

function report(overrides: Partial<ReportData> = {}): ReportData {
  return {
    teacherName: "Indrani Khan",
    responseCount: 36,
    percentage: 95.5,
    parameters: [
      {
        parameter: "Curiosity",
        percentage: 93,
        answeredBy: 36,
        questions: [
          {
            questionTag: "Real life Examples",
            text: "Does the teacher use real-world examples?",
            percentage: 93,
            answeredBy: 36,
            options: ["Regularly", "Sometimes", "Rarely"],
            optionCounts: [33, 1, 2],
          },
        ],
      },
      { parameter: "Planning", percentage: 0, answeredBy: 0, questions: [] },
    ],
    comments: [
      { role: "liked", text: "Explains well" },
      { role: "improve", text: "Start on time" },
    ],
    nothingCounts: { liked: 0, improve: 14 },
    byGender: { female: summary(98, 12), male: summary(91, 24) },
    round: {
      cycleLabel: "Sep 2026",
      centreName: "JNV Kurnool CoE",
      batchNames: ["2027 Engineering"],
      startTime: "2026-09-17 11:32:28",
      endTime: "2026-09-18 11:32:28",
    },
    history: [
      history("a27", "Aug 2026", "2027 Engineering", 92.8),
      history("a28", "Aug 2026", "2028 Engineering", 93.8),
      history("q1", "Sep 2026", "2027 Engineering", 95.5),
    ],
    ...overrides,
  };
}

let response: () => Promise<Response>;

function show(data: ReportData | null = report()) {
  if (data) response = () => Promise.resolve(new Response(JSON.stringify(data)));
  const onClose = vi.fn();
  render(<AnalysisModal quizId="q1" teacherName="Indrani Khan" onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => response()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnalysisModal", () => {
  it("shows the round, the overall score and the change since that batch's last round", async () => {
    show();

    expect((await screen.findByText(/overall · 36 responses/)).previousElementSibling).toHaveTextContent("96%");
    expect(screen.getByText("Sep 2026 · 2027 Engineering")).toBeInTheDocument();
    // Compared with Aug for the same batch (92.8), not the 2028 batch.
    expect(screen.getByText("▲ 3 vs Aug 2026")).toBeInTheDocument();
  });

  it("expands a parameter into its questions and how students answered", async () => {
    show();
    const curiosity = await screen.findByRole("button", { name: /Curiosity/ });
    expect(screen.queryByText("Real life Examples")).not.toBeInTheDocument();

    fireEvent.click(curiosity);
    expect(screen.getByText("Real life Examples")).toBeInTheDocument();
    expect(screen.getByText("Sometimes").parentElement).toHaveTextContent("1 / 36");
    // A parameter nobody rated shows a dash, not 0%.
    expect(within(screen.getByRole("button", { name: /Planning/ })).getByText("–")).toBeInTheDocument();
  });

  it("splits by gender when both groups are big enough", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Girls vs boys" }));

    expect(screen.getByText("12 girls · 24 boys")).toBeInTheDocument();
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("won't split by gender when a group is too small", async () => {
    show(report({ byGender: { female: summary(98, 12) } }));

    expect(await screen.findByRole("button", { name: "Girls vs boys" })).toBeDisabled();
  });

  it("tables this round's batch over the months, without the teacher's other batches", async () => {
    show();
    const table = await screen.findByRole("table");

    expect(within(table).getByText("2027 Engineering").closest("tr")).toHaveTextContent(/93%.*96%/);
    expect(within(table).queryByText("2028 Engineering")).not.toBeInTheDocument();
    expect(within(table).queryByText("–")).not.toBeInTheDocument();
  });

  it("lists comments, counting the 'nothing' answers instead", async () => {
    show(report({ history: [], comments: [{ role: "improve", text: "Start on time" }] }));

    expect(await screen.findByText("Start on time")).toBeInTheDocument();
    expect(screen.getByText("14 students wrote “nothing” or similar.")).toBeInTheDocument();
    expect(screen.getByText("No comments.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("handles no responses, errors and closing", async () => {
    const onClose = show(report({ responseCount: 0 }));
    expect(await screen.findByText("No student responses yet for this teacher.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's error", async () => {
    response = () => Promise.resolve(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    show(null);
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
  });
});

describe("previousRound", () => {
  it("finds the same batches' latest earlier round, or none", () => {
    const h = report().history;
    expect(previousRound(h, "q1")?.quizId).toBe("a27");
    expect(previousRound(h, "a27")).toBeNull();
    expect(previousRound(h, "missing")).toBeNull();
    expect(previousRound(h, "a28")).toBeNull();
  });
});

describe("batchHistory", () => {
  it("shows only rounds sharing a batch, up to this round's month", () => {
    const h = [
      history("a27", "Aug 2026", "2027 Engineering", 92),
      history("a28", "Aug 2026", "2028 Engineering", 93),
      history("s28", "Sep 2026", "2028 Engineering", 96),
      history("s27", "Sep 2026", "2027 Engineering", 95),
      history("o27", "Oct 2026", "2027 Engineering", 97),
    ];
    // The 2028 Sep round: no 2027 row, and no October.
    expect(batchHistory(h, "s28").map((x) => x.quizId)).toEqual(["a28", "s28"]);
    expect(batchHistory(h, "a27").map((x) => x.quizId)).toEqual(["a27"]);
    expect(batchHistory(h, "missing")).toEqual([]);
  });

  it("keeps comparing when batches are regrouped between months", () => {
    const all = { ...history("aug", "Aug 2026", "A", 90), batchNames: ["A", "B"] };
    const pair = history("sep", "Sep 2026", "A", 94);
    expect(batchHistory([all, pair], "sep").map((x) => x.quizId)).toEqual(["aug", "sep"]);
    expect(previousRound([all, pair], "sep")?.quizId).toBe("aug");
  });
});
