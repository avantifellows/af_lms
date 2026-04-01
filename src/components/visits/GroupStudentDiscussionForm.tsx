"use client";

import { useCallback, useMemo, useState } from "react";

import {
  GROUP_STUDENT_DISCUSSION_CONFIG,
  VALID_GRADES,
} from "@/lib/group-student-discussion";

interface GroupStudentDiscussionFormProps {
  data: Record<string, unknown>;
  setData: (data: Record<string, unknown>) => void;
  disabled: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getQuestionsFromData(
  data: Record<string, unknown>
): Record<string, { answer: boolean | null; remark?: string }> {
  if (!isPlainObject(data.questions)) {
    return {};
  }
  return data.questions as Record<
    string,
    { answer: boolean | null; remark?: string }
  >;
}

export default function GroupStudentDiscussionForm({
  data,
  setData,
  disabled,
}: GroupStudentDiscussionFormProps) {
  const [revealedRemarks, setRevealedRemarks] = useState<Set<string>>(
    () => new Set()
  );

  const grade =
    typeof data.grade === "number" && VALID_GRADES.includes(data.grade as 11 | 12)
      ? (data.grade as number)
      : null;

  const hasQuestionAnswers = useMemo(() => {
    const questions = getQuestionsFromData(data);
    return GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.some((key) => {
      const entry = questions[key];
      return entry && typeof entry.answer === "boolean";
    });
  }, [data]);

  const gradeSelected = grade !== null || hasQuestionAnswers;

  const questions = getQuestionsFromData(data);

  const handleGradeChange = useCallback(
    (value: string) => {
      const numValue = Number(value);
      setData({
        ...data,
        grade: numValue,
      });
    },
    [data, setData]
  );

  const handleAnswerChange = useCallback(
    (key: string, answer: boolean) => {
      setData({
        ...data,
        questions: {
          ...(isPlainObject(data.questions) ? data.questions : {}),
          [key]: {
            ...(isPlainObject(data.questions) &&
            isPlainObject(
              (data.questions as Record<string, unknown>)[key]
            )
              ? ((data.questions as Record<string, unknown>)[key] as Record<
                  string,
                  unknown
                >)
              : {}),
            answer,
          },
        },
      });
    },
    [data, setData]
  );

  const handleRemarkChange = useCallback(
    (key: string, remark: string) => {
      setData({
        ...data,
        questions: {
          ...(isPlainObject(data.questions) ? data.questions : {}),
          [key]: {
            ...(isPlainObject(data.questions) &&
            isPlainObject(
              (data.questions as Record<string, unknown>)[key]
            )
              ? ((data.questions as Record<string, unknown>)[key] as Record<
                  string,
                  unknown
                >)
              : {}),
            remark,
          },
        },
      });
    },
    [data, setData]
  );

  const answeredCount = useMemo(() => {
    let count = 0;
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      const entry = questions[key];
      if (entry && typeof entry.answer === "boolean") {
        count += 1;
      }
    }
    return count;
  }, [questions]);

  return (
    <div
      className="space-y-4"
      data-testid="action-renderer-group_student_discussion"
    >
      {/* Grade dropdown */}
      <div className="border border-border p-4">
        <label className="block text-sm font-semibold text-text-primary uppercase mb-2">
          Grade
        </label>
        <select
          value={grade ?? ""}
          onChange={(e) => handleGradeChange(e.target.value)}
          disabled={disabled}
          className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-bg-card-alt"
          data-testid="group-student-grade-select"
        >
          <option value="" disabled>
            -- Select Grade --
          </option>
          {VALID_GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {/* Progress summary — only after grade selected */}
      {gradeSelected && (
        <div
          className="sticky top-12 z-10 border-2 border-border-accent bg-bg-card-alt px-3 py-2"
          data-testid="group-student-discussion-progress"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
            <span className="font-mono">
              Answered: {answeredCount}/
              {GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.length}
            </span>
          </div>
        </div>
      )}

      {/* Sections — only after grade selected */}
      {gradeSelected &&
        GROUP_STUDENT_DISCUSSION_CONFIG.sections.map((section) => (
          <section
            key={section.title}
            className="border border-border p-4 space-y-4"
          >
            <h3 className="text-sm font-semibold text-text-primary uppercase">
              {section.title} Grade {grade}
            </h3>

            {section.questions.map((question) => {
              const entry = questions[question.key];
              const answer = entry?.answer ?? null;
              const remark =
                typeof entry?.remark === "string" ? entry.remark : "";
              const remarkVisible =
                remark.length > 0 || revealedRemarks.has(question.key);

              return (
                <div key={question.key}>
                  <fieldset disabled={disabled}>
                    <legend className="sr-only">{question.label}</legend>
                    <p className="mb-2 text-sm text-text-primary">
                      {question.label}
                    </p>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                        <input
                          type="radio"
                          name={`group-student-${question.key}`}
                          checked={answer === true}
                          onChange={() =>
                            handleAnswerChange(question.key, true)
                          }
                          disabled={disabled}
                          className="h-4 w-4 accent-accent"
                          data-testid={`group-student-${question.key}-yes`}
                        />
                        Yes
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                        <input
                          type="radio"
                          name={`group-student-${question.key}`}
                          checked={answer === false}
                          onChange={() =>
                            handleAnswerChange(question.key, false)
                          }
                          disabled={disabled}
                          className="h-4 w-4 accent-accent"
                          data-testid={`group-student-${question.key}-no`}
                        />
                        No
                      </label>
                    </div>
                  </fieldset>

                  {!remarkVisible && !disabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setRevealedRemarks((current) =>
                          new Set(current).add(question.key)
                        );
                      }}
                      className="mt-2 text-xs font-medium text-accent underline hover:text-accent-hover"
                    >
                      Add remark
                    </button>
                  )}

                  {remarkVisible && (
                    <label className="mt-2 block">
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                        Remark
                      </span>
                      <textarea
                        rows={2}
                        value={remark}
                        disabled={disabled}
                        onChange={(e) =>
                          handleRemarkChange(question.key, e.target.value)
                        }
                        placeholder="Optional remark"
                        className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-bg-card-alt"
                        data-testid={`group-student-${question.key}-remark`}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </section>
        ))}
    </div>
  );
}
