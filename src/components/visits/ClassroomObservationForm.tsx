"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
  type ParamData,
  type RubricParameter,
} from "@/lib/classroom-observation-rubric";

interface ClassroomObservationFormProps {
  data: Record<string, unknown>;
  setData: Dispatch<SetStateAction<Record<string, unknown>>>;
  disabled: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getParams(data: Record<string, unknown>): Record<string, ParamData> {
  if (!isPlainObject(data.params)) {
    return {};
  }

  return data.params as Record<string, ParamData>;
}

function isValidScore(parameter: RubricParameter, score: unknown): score is number {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return false;
  }

  return parameter.options.some((option) => option.score === score);
}

export default function ClassroomObservationForm({
  data,
  setData,
  disabled,
}: ClassroomObservationFormProps) {
  const [revealedRemarks, setRevealedRemarks] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setData((current) => {
      if (typeof current.rubric_version === "string") {
        return current;
      }

      return { ...current, rubric_version: CURRENT_RUBRIC_VERSION };
    });
  }, [setData]);

  const params = getParams(data);

  const { answeredCount, totalScore } = useMemo(() => {
    let answered = 0;
    let score = 0;

    for (const parameter of CLASSROOM_OBSERVATION_RUBRIC.parameters) {
      const selectedScore = params[parameter.key]?.score;
      if (isValidScore(parameter, selectedScore)) {
        answered += 1;
        score += selectedScore;
      }
    }

    return {
      answeredCount: answered,
      totalScore: score,
    };
  }, [params]);

  return (
    <div className="space-y-4" data-testid="classroom-observation-form">
      <div className="sticky top-2 z-10 border-2 border-border-accent bg-bg-card-alt px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
          <span className="font-mono font-bold text-accent" data-testid="rubric-score-summary">
            Score: {totalScore}/{CLASSROOM_OBSERVATION_RUBRIC.maxScore}
          </span>
          <span className="font-mono" data-testid="rubric-answered-summary">
            Answered: {answeredCount}/{CLASSROOM_OBSERVATION_RUBRIC.parameters.length}
          </span>
        </div>
      </div>

      {CLASSROOM_OBSERVATION_RUBRIC.parameters.map((parameter) => {
        const paramValue = params[parameter.key];
        const selectedScore = paramValue?.score;
        const remarks = readString(paramValue?.remarks);
        const remarksVisible = remarks.length > 0 || revealedRemarks.has(parameter.key);

        return (
          <section
            key={parameter.key}
            className="border border-border p-4"
            data-testid={`rubric-param-${parameter.key}`}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-text-primary uppercase">{parameter.label}</h3>
              {parameter.description && (
                <p className="mt-1 text-xs text-text-secondary">{parameter.description}</p>
              )}
            </div>

            <fieldset disabled={disabled} className="space-y-2">
              <legend className="sr-only">{parameter.label}</legend>
              {parameter.options.map((option) => (
                <label
                  key={`${parameter.key}-${option.score}`}
                  className="flex cursor-pointer items-start gap-2 text-sm text-text-primary"
                >
                  <input
                    type="radio"
                    name={`rubric-${parameter.key}`}
                    value={option.score}
                    checked={selectedScore === option.score}
                    disabled={disabled}
                    onChange={() => {
                      setData((current) => {
                        const currentParams = isPlainObject(current.params)
                          ? { ...current.params }
                          : {};
                        const currentParam = isPlainObject(currentParams[parameter.key])
                          ? { ...(currentParams[parameter.key] as Record<string, unknown>) }
                          : {};

                        currentParams[parameter.key] = {
                          ...currentParam,
                          score: option.score,
                        };

                        return {
                          ...current,
                          params: currentParams,
                        };
                      });
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span>
                    {option.label}
                    <span className="ml-1 font-mono text-text-muted">({option.score})</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {!remarksVisible && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setRevealedRemarks((current) => new Set(current).add(parameter.key));
                }}
                className="mt-3 text-xs font-medium text-accent underline hover:text-accent-hover disabled:cursor-not-allowed disabled:text-text-muted"
              >
                Add remarks
              </button>
            )}

            {remarksVisible && (
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">Remarks</span>
                <textarea
                  rows={3}
                  value={remarks}
                  disabled={disabled}
                  onChange={(event) => {
                    const nextRemarks = event.target.value;
                    setData((current) => {
                      const currentParams = isPlainObject(current.params)
                        ? { ...current.params }
                        : {};
                      const currentParam = isPlainObject(currentParams[parameter.key])
                        ? { ...(currentParams[parameter.key] as Record<string, unknown>) }
                        : {};

                      currentParams[parameter.key] = {
                        ...currentParam,
                        remarks: nextRemarks,
                      };

                      return {
                        ...current,
                        params: currentParams,
                      };
                    });
                  }}
                  placeholder="Optional remarks"
                  className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-bg-card-alt"
                />
              </label>
            )}
          </section>
        );
      })}

      <section className="border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary uppercase">Session Summary (Optional)</h3>
        {CLASSROOM_OBSERVATION_RUBRIC.sessionFields.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">{field.label}</span>
            <textarea
              rows={4}
              value={readString(data[field.key])}
              disabled={disabled}
              placeholder={field.placeholder}
              onChange={(event) => {
                const nextValue = event.target.value;
                setData((current) => ({ ...current, [field.key]: nextValue }));
              }}
              className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-bg-card-alt"
            />
          </label>
        ))}
      </section>
    </div>
  );
}
