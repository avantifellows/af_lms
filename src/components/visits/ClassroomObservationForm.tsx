"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  CLASSROOM_OBSERVATION_RUBRIC,
  CURRENT_RUBRIC_VERSION,
  VALID_GRADES,
  type ParamData,
  type RubricParameter,
} from "@/lib/classroom-observation-rubric";

interface Teacher {
  id: number;
  email: string;
  full_name: string | null;
}

interface ClassroomObservationFormProps {
  data: Record<string, unknown>;
  setData: Dispatch<SetStateAction<Record<string, unknown>>>;
  disabled: boolean;
  schoolCode: string;
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

function getTeacherDisplayName(teacher: Teacher): string {
  return teacher.full_name || teacher.email;
}

export default function ClassroomObservationForm({
  data,
  setData,
  disabled,
  schoolCode,
}: ClassroomObservationFormProps) {
  const [revealedRemarks, setRevealedRemarks] = useState<Set<string>>(() => new Set());
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);

  useEffect(() => {
    setData((current) => {
      if (typeof current.rubric_version === "string") {
        return current;
      }

      return { ...current, rubric_version: CURRENT_RUBRIC_VERSION };
    });
  }, [setData]);

  useEffect(() => {
    let cancelled = false;

    async function fetchTeachers() {
      setTeachersLoading(true);
      setTeachersError(null);

      try {
        const response = await fetch(`/api/pm/teachers?school_code=${encodeURIComponent(schoolCode)}`);
        if (!response.ok) {
          throw new Error("Failed to load teachers");
        }
        const body = await response.json();
        if (!cancelled) {
          setTeachers(Array.isArray(body.teachers) ? body.teachers : []);
        }
      } catch {
        if (!cancelled) {
          setTeachersError("Failed to load teachers");
        }
      } finally {
        if (!cancelled) {
          setTeachersLoading(false);
        }
      }
    }

    void fetchTeachers();

    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  const selectedTeacherId =
    typeof data.teacher_id === "number" && Number.isFinite(data.teacher_id) ? data.teacher_id : null;
  const selectedTeacherName = typeof data.teacher_name === "string" ? data.teacher_name : null;
  const selectedGrade = typeof data.grade === "string" ? data.grade : null;

  const teacherInList = selectedTeacherId !== null && teachers.some((t) => Number(t.id) === selectedTeacherId);

  const teachersRef = useRef(teachers);
  teachersRef.current = teachers;

  const handleTeacherChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const id = Number(event.target.value);
      const teacher = teachersRef.current.find((t) => Number(t.id) === id);
      if (!teacher) {
        return;
      }

      setData((current) => ({
        ...current,
        teacher_id: Number(teacher.id),
        teacher_name: getTeacherDisplayName(teacher),
      }));
    },
    [setData]
  );

  const handleGradeChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const grade = event.target.value;
      setData((current) => ({
        ...current,
        grade,
      }));
    },
    [setData]
  );

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

  const hasTeacher = selectedTeacherId !== null;
  const hasGrade = selectedGrade !== null && (VALID_GRADES as readonly string[]).includes(selectedGrade);
  const showRubric = hasTeacher && hasGrade;

  return (
    <div className="space-y-4" data-testid="classroom-observation-form">
      {/* Teacher selection */}
      <section className="border border-border p-4" data-testid="teacher-selection">
        <h3 className="mb-2 text-sm font-semibold text-text-primary uppercase">Teacher</h3>
        {disabled ? (
          <p className="text-sm text-text-primary" data-testid="teacher-display">
            {selectedTeacherName || "No teacher selected"}
          </p>
        ) : teachersLoading ? (
          <p className="text-sm text-text-muted" data-testid="teacher-loading">Loading teachers...</p>
        ) : teachersError ? (
          <p className="text-sm text-danger" data-testid="teacher-error">{teachersError}</p>
        ) : (
          <>
            {selectedTeacherId !== null && !teacherInList && selectedTeacherName && (
              <p className="mb-2 text-sm text-text-primary" data-testid="teacher-removed-display">
                {selectedTeacherName} (no longer at this school)
              </p>
            )}
            {(teacherInList || selectedTeacherId === null) && (
              <select
                value={selectedTeacherId !== null ? String(selectedTeacherId) : ""}
                onChange={handleTeacherChange}
                className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                data-testid="teacher-select"
              >
                <option value="" disabled>
                  {teachers.length === 0 ? "No teachers found" : "Select a teacher"}
                </option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={String(teacher.id)}>
                    {getTeacherDisplayName(teacher)}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </section>

      {/* Grade selection — visible only after teacher is selected */}
      {hasTeacher && (
        <section className="border border-border p-4" data-testid="grade-selection">
          <h3 className="mb-2 text-sm font-semibold text-text-primary uppercase">Grade</h3>
          {disabled ? (
            <p className="text-sm text-text-primary" data-testid="grade-display">
              {selectedGrade ? `Grade ${selectedGrade}` : "No grade selected"}
            </p>
          ) : (
            <select
              value={selectedGrade ?? ""}
              onChange={handleGradeChange}
              className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              data-testid="grade-select"
            >
              <option value="" disabled>
                Select a grade
              </option>
              {VALID_GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  Grade {grade}
                </option>
              ))}
            </select>
          )}
        </section>
      )}

      {/* Gating messages */}
      {!hasTeacher && !disabled && (
        <p className="text-sm text-text-muted px-1" data-testid="select-teacher-prompt">
          Select a teacher to begin the observation.
        </p>
      )}
      {hasTeacher && !hasGrade && !disabled && (
        <p className="text-sm text-text-muted px-1" data-testid="select-grade-prompt">
          Select a grade to continue.
        </p>
      )}

      {/* Rubric form — visible only after both teacher and grade are selected */}
      {showRubric && (
        <>
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
        </>
      )}
    </div>
  );
}
