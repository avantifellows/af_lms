"use client";

import { useCallback, useMemo } from "react";

import { PRINCIPAL_INTERACTION_CONFIG } from "@/lib/principal-interaction";
import { isPlainObject } from "@/lib/visit-form-utils";
import { FormSection, RadioPair, RemarkField, StickyProgressBar } from "@/components/ui";

interface PrincipalInteractionFormProps {
  data: Record<string, unknown>;
  setData: (data: Record<string, unknown>) => void;
  disabled: boolean;
}

function getQuestionsFromData(data: Record<string, unknown>): Record<string, { answer: boolean | null; remark?: string }> {
  if (!isPlainObject(data.questions)) {
    return {};
  }
  return data.questions as Record<string, { answer: boolean | null; remark?: string }>;
}

export default function PrincipalInteractionForm({
  data,
  setData,
  disabled,
}: PrincipalInteractionFormProps) {
  const questions = getQuestionsFromData(data);

  const handleAnswerChange = useCallback(
    (key: string, answer: boolean) => {
      setData({
        ...data,
        questions: {
          ...(isPlainObject(data.questions) ? data.questions : {}),
          [key]: {
            ...(isPlainObject(data.questions) && isPlainObject((data.questions as Record<string, unknown>)[key])
              ? (data.questions as Record<string, unknown>)[key] as Record<string, unknown>
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
            ...(isPlainObject(data.questions) && isPlainObject((data.questions as Record<string, unknown>)[key])
              ? (data.questions as Record<string, unknown>)[key] as Record<string, unknown>
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
    for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
      const entry = questions[key];
      if (entry && typeof entry.answer === "boolean") {
        count += 1;
      }
    }
    return count;
  }, [questions]);

  return (
    <div className="space-y-4" data-testid="action-renderer-principal_interaction">
      {/* Progress summary */}
      <StickyProgressBar
        data-testid="principal-interaction-progress"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
          <span className="font-mono">
            Answered: {answeredCount}/{PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys.length}
          </span>
        </div>
      </StickyProgressBar>

      {/* Sections */}
      {PRINCIPAL_INTERACTION_CONFIG.sections.map((section) => (
        <FormSection key={section.title}>
          <h3 className="text-sm font-semibold text-text-primary uppercase">{section.title}</h3>

          {section.questions.map((question) => {
            const entry = questions[question.key];
            const answer = entry?.answer ?? null;
            const remark = typeof entry?.remark === "string" ? entry.remark : "";

            return (
              <div key={question.key}>
                <fieldset disabled={disabled}>
                  <legend className="sr-only">{question.label}</legend>
                  <p className="mb-2 text-sm text-text-primary">{question.label}</p>
                  <RadioPair
                    name={`principal-interaction-${question.key}`}
                    value={answer}
                    onChange={(val) => handleAnswerChange(question.key, val)}
                    disabled={disabled}
                    yesTestId={`principal-interaction-${question.key}-yes`}
                    noTestId={`principal-interaction-${question.key}-no`}
                  />
                </fieldset>

                <RemarkField
                  value={remark}
                  onChange={(val) => handleRemarkChange(question.key, val)}
                  disabled={disabled}
                  testId={`principal-interaction-${question.key}-remark`}
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
