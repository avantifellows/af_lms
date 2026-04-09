"use client";

import { useCallback, useMemo } from "react";

import {
  GROUP_STUDENT_DISCUSSION_CONFIG,
  VALID_GRADES,
} from "@/lib/group-student-discussion";
import { isPlainObject } from "@/lib/visit-form-utils";
import { FormSection, RadioPair, RemarkField, Select, StickyProgressBar } from "@/components/ui";

interface GroupStudentDiscussionFormProps {
  data: Record<string, unknown>;
  setData: (data: Record<string, unknown>) => void;
  disabled: boolean;
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
      <FormSection spacing="">
        <label className="block text-sm font-semibold text-text-primary uppercase mb-2">
          Grade
        </label>
        <Select
          value={grade ?? ""}
          onChange={(e) => handleGradeChange(e.target.value)}
          disabled={disabled}
          className="w-full"
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
        </Select>
      </FormSection>

      {/* Progress summary — only after grade selected */}
      {gradeSelected && (
        <StickyProgressBar
          data-testid="group-student-discussion-progress"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
            <span className="font-mono">
              Answered: {answeredCount}/
              {GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.length}
            </span>
          </div>
        </StickyProgressBar>
      )}

      {/* Sections — only after grade selected */}
      {gradeSelected &&
        GROUP_STUDENT_DISCUSSION_CONFIG.sections.map((section) => (
          <FormSection key={section.title}>
            <h3 className="text-sm font-semibold text-text-primary uppercase">
              {section.title} Grade {grade}
            </h3>

            {section.questions.map((question) => {
              const entry = questions[question.key];
              const answer = entry?.answer ?? null;
              const remark =
                typeof entry?.remark === "string" ? entry.remark : "";

              return (
                <div key={question.key}>
                  <fieldset disabled={disabled}>
                    <legend className="sr-only">{question.label}</legend>
                    <p className="mb-2 text-sm text-text-primary">
                      {question.label}
                    </p>
                    <RadioPair
                      name={`group-student-${question.key}`}
                      value={answer}
                      onChange={(val) => handleAnswerChange(question.key, val)}
                      disabled={disabled}
                      yesTestId={`group-student-${question.key}-yes`}
                      noTestId={`group-student-${question.key}-no`}
                    />
                  </fieldset>

                  <RemarkField
                    value={remark}
                    onChange={(val) => handleRemarkChange(question.key, val)}
                    disabled={disabled}
                    testId={`group-student-${question.key}-remark`}
                    defaultRevealed={remark.length > 0}
                  />
                </div>
              );
            })}
          </FormSection>
        ))}
    </div>
  );
}
