import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionContentView, { RichText, answerLabel } from "./QuestionContentView";
import type { QuestionContent } from "@/types/question-analytics";

const CONTENT: QuestionContent = {
  id: 9248,
  type: "mcq_single_answer",
  text: '<div>Ratio is \\(\\frac{1}{10}\\)?<img src="x" onerror="window.__pwned=1"><script>window.__pwned=1</script></div>',
  options: ["1/100", "1/10", "10/1", "3/2"],
  answer: ["4"],
  solutions: ["<div>Because 121/81</div>"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RichText", () => {
  it("strips scripts and event handlers, and renders the maths", () => {
    const { container } = render(<RichText html={CONTENT.text} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("onerror")).toBeNull();
    expect(container.querySelector(".katex")).not.toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("answerLabel", () => {
  it("shows MCQ answers as letters and other answers as they are", () => {
    expect(answerLabel(CONTENT)).toBe("D");
    expect(answerLabel({ ...CONTENT, answer: ["1", "3"] })).toBe("A, C");
    expect(answerLabel({ ...CONTENT, options: [], answer: ["2"] })).toBe("2");
    expect(answerLabel({ ...CONTENT, answer: [] })).toBe("—");
  });
});

describe("QuestionContentView", () => {
  it("loads the question, then shows its options, answer and solution on demand", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(CONTENT) }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuestionContentView schoolUdise="2332" sessionQuery="grade=12&sessionId=s1" cmsQuestionId={9248} />);

    expect(screen.getByText("Loading question…")).toBeInTheDocument();
    expect(await screen.findByText("(D)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quiz-analytics/2332/question-content?grade=12&sessionId=s1&questionId=9248",
      expect.anything()
    );
    expect(screen.getByText("Correct answer").nextElementSibling).toHaveTextContent("D");
    expect(screen.queryByText("Because 121/81")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show solution" }));
    expect(screen.getByText("Because 121/81")).toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "Question not found in this test" }) })
    ));
    render(<QuestionContentView schoolUdise="2332" sessionQuery="grade=12&sessionId=s1" cmsQuestionId={1} />);
    expect(await screen.findByText("Question not found in this test")).toBeInTheDocument();
  });
});
