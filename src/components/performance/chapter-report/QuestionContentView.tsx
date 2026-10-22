"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import type { QuestionContent } from "@/types/question-analytics";

// CMS question text is HTML with LaTeX between \( \) or \[ \] and images inlined
// as data: URIs. It is sanitised before it touches the DOM, then KaTeX renders the
// maths in place. Shared with Teacher View v2 (#324).
const MATH_DELIMITERS = [
  { left: "\\(", right: "\\)", display: false },
  { left: "\\[", right: "\\]", display: true },
  { left: "$$", right: "$$", display: true },
];

/** Sanitised HTML with its maths rendered. */
export function RichText({ html, className = "" }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = DOMPurify.sanitize(html);
    renderMathInElement(el, { delimiters: MATH_DELIMITERS, throwOnError: false });
  }, [html]);
  return <div ref={ref} className={`text-sm text-text-primary [&_img]:max-w-full ${className}`} />;
}

/** MCQ answers are 1-based option numbers in the CMS; shown as letters. */
export function answerLabel(content: QuestionContent): string {
  if (content.answer.length === 0) return "—";
  if (content.options.length > 0) {
    return content.answer
      .map((a) => {
        const n = Number(a);
        return Number.isInteger(n) && n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : a;
      })
      .join(", ");
  }
  return content.answer.join(", ");
}

interface Props {
  schoolUdise: string;
  /** grade, sessionId, program, stream: the server finds the CMS test from the session. */
  sessionQuery: string;
  cmsQuestionId: number;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; content: QuestionContent };

/** Fetches one question from the CMS (via the LMS) and shows it with options, answer and solution. */
export default function QuestionContentView({ schoolUdise, sessionQuery, cmsQuestionId }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [showSolution, setShowSolution] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ status: "loading" });
    fetch(
      `/api/quiz-analytics/${schoolUdise}/question-content?${sessionQuery}&questionId=${cmsQuestionId}`,
      { signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Failed to load the question");
        }
        return res.json() as Promise<QuestionContent>;
      })
      .then((content) => {
        if (current) setState({ status: "ready", content });
      })
      .catch((err) => {
        if (current && err.name !== "AbortError") setState({ status: "error", message: err.message });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [schoolUdise, sessionQuery, cmsQuestionId]);

  if (state.status === "loading") {
    return <p className="text-xs text-text-muted">Loading question…</p>;
  }
  if (state.status === "error") {
    return <p className="text-xs text-danger">{state.message}</p>;
  }

  const { content } = state;
  return (
    <div className="space-y-3">
      <RichText html={content.text} />
      {content.options.length > 0 && (
        <ol className="space-y-1">
          {content.options.map((option, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-sm font-bold text-text-secondary">
                ({String.fromCharCode(65 + i)})
              </span>
              <RichText html={option} />
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">Correct answer </span>
        <span className="font-mono font-bold text-text-primary">{answerLabel(content)}</span>
      </p>
      {content.solutions.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowSolution((v) => !v)}
            className="text-xs font-bold uppercase tracking-wide text-accent hover:text-accent-hover min-h-[44px]"
          >
            {showSolution ? "Hide solution" : "Show solution"}
          </button>
          {showSolution && (
            <div className="space-y-2 border-l-2 border-border pl-3">
              {content.solutions.map((s, i) => (
                <RichText key={i} html={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
