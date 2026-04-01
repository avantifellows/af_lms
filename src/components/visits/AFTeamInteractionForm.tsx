"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction";
import { getTeacherDisplayName, type Teacher } from "@/lib/teacher-utils";

interface AFTeamInteractionFormProps {
  data: Record<string, unknown>;
  setData: Dispatch<SetStateAction<Record<string, unknown>>>;
  disabled: boolean;
  schoolCode: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getTeachersFromData(data: Record<string, unknown>): Array<{ id: number; name: string }> {
  if (!Array.isArray(data.teachers)) {
    return [];
  }
  return data.teachers.filter(
    (t): t is { id: number; name: string } =>
      isPlainObject(t) && typeof t.id === "number" && typeof t.name === "string"
  );
}

function getQuestionsFromData(data: Record<string, unknown>): Record<string, { answer: boolean | null; remark?: string }> {
  if (!isPlainObject(data.questions)) {
    return {};
  }
  return data.questions as Record<string, { answer: boolean | null; remark?: string }>;
}

export default function AFTeamInteractionForm({
  data,
  setData,
  disabled,
  schoolCode,
}: AFTeamInteractionFormProps) {
  const [revealedRemarks, setRevealedRemarks] = useState<Set<string>>(() => new Set());
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);

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

  const selectedTeachers = getTeachersFromData(data);
  const selectedTeacherIds = useMemo(() => new Set(selectedTeachers.map((t) => t.id)), [selectedTeachers]);
  const questions = getQuestionsFromData(data);

  const fetchedTeacherIds = useMemo(() => new Set(teachers.map((t) => Number(t.id))), [teachers]);

  const removedTeachers = useMemo(
    () => selectedTeachers.filter((t) => !fetchedTeacherIds.has(t.id)),
    [selectedTeachers, fetchedTeacherIds]
  );

  const allFetchedSelected = useMemo(
    () => teachers.length > 0 && teachers.every((t) => selectedTeacherIds.has(Number(t.id))),
    [teachers, selectedTeacherIds]
  );

  const teachersRef = useRef(teachers);
  teachersRef.current = teachers;

  const handleTeacherToggle = useCallback(
    (teacherId: number, checked: boolean) => {
      setData((current) => {
        const currentTeachers = getTeachersFromData(current);
        if (checked) {
          const teacher = teachersRef.current.find((t) => Number(t.id) === teacherId);
          if (!teacher) return current;
          const name = getTeacherDisplayName(teacher);
          return {
            ...current,
            teachers: [...currentTeachers, { id: Number(teacher.id), name }],
          };
        } else {
          return {
            ...current,
            teachers: currentTeachers.filter((t) => t.id !== teacherId),
          };
        }
      });
    },
    [setData]
  );

  const handleSelectAll = useCallback(() => {
    setData((current) => {
      const currentTeachers = getTeachersFromData(current);
      const currentIds = new Set(currentTeachers.map((t) => t.id));
      const allSelected = teachersRef.current.length > 0 && teachersRef.current.every((t) => currentIds.has(Number(t.id)));

      if (allSelected) {
        // Deselect all fetched teachers, keep removed teachers
        const fetchedIds = new Set(teachersRef.current.map((t) => Number(t.id)));
        return {
          ...current,
          teachers: currentTeachers.filter((t) => !fetchedIds.has(t.id)),
        };
      } else {
        // Select all fetched teachers, keep removed teachers
        const merged = [...currentTeachers];
        for (const teacher of teachersRef.current) {
          if (!currentIds.has(Number(teacher.id))) {
            merged.push({ id: Number(teacher.id), name: getTeacherDisplayName(teacher) });
          }
        }
        return { ...current, teachers: merged };
      }
    });
  }, [setData]);

  const handleAnswerChange = useCallback(
    (key: string, answer: boolean) => {
      setData((current) => {
        const currentQuestions = isPlainObject(current.questions)
          ? { ...current.questions }
          : {};
        const currentEntry = isPlainObject(currentQuestions[key])
          ? { ...(currentQuestions[key] as Record<string, unknown>) }
          : {};

        currentQuestions[key] = { ...currentEntry, answer };
        return { ...current, questions: currentQuestions };
      });
    },
    [setData]
  );

  const handleRemarkChange = useCallback(
    (key: string, remark: string) => {
      setData((current) => {
        const currentQuestions = isPlainObject(current.questions)
          ? { ...current.questions }
          : {};
        const currentEntry = isPlainObject(currentQuestions[key])
          ? { ...(currentQuestions[key] as Record<string, unknown>) }
          : {};

        currentQuestions[key] = { ...currentEntry, remark };
        return { ...current, questions: currentQuestions };
      });
    },
    [setData]
  );

  const { answeredCount, teacherCount } = useMemo(() => {
    let answered = 0;
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      const entry = questions[key];
      if (entry && typeof entry.answer === "boolean") {
        answered += 1;
      }
    }
    return {
      answeredCount: answered,
      teacherCount: selectedTeachers.length,
    };
  }, [questions, selectedTeachers]);

  const hasTeachers = selectedTeachers.length > 0;
  const hasExistingAnswers = useMemo(() => {
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      const entry = questions[key];
      if (entry && entry.answer !== null && entry.answer !== undefined) {
        return true;
      }
    }
    return false;
  }, [questions]);

  const showQuestions = hasTeachers || hasExistingAnswers || disabled;

  return (
    <div className="space-y-4" data-testid="action-renderer-af_team_interaction">
      {/* Teacher selection */}
      <section className="border border-border p-4" data-testid="af-team-teacher-section">
        <h3 className="mb-2 text-sm font-semibold text-text-primary uppercase">Teachers Present</h3>
        {disabled ? (
          <div className="space-y-1">
            {selectedTeachers.length === 0 ? (
              <p className="text-sm text-text-muted">No teachers selected</p>
            ) : (
              selectedTeachers.map((t) => (
                <span key={t.id} className="block text-sm text-text-primary">
                  {t.name || `Teacher #${t.id}`}
                </span>
              ))
            )}
          </div>
        ) : teachersLoading ? (
          <p className="text-sm text-text-muted" data-testid="af-team-teacher-loading">Loading teachers...</p>
        ) : teachersError ? (
          <p className="text-sm text-danger" data-testid="af-team-teacher-error">{teachersError}</p>
        ) : (
          <>
            {removedTeachers.length > 0 && (
              <div className="mb-2 space-y-1">
                {removedTeachers.map((t) => (
                  <p key={t.id} className="text-sm text-text-secondary" data-testid={`af-team-removed-teacher-${t.id}`}>
                    {t.name || `Teacher #${t.id}`} (no longer at this school)
                  </p>
                ))}
              </div>
            )}

            {teachers.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAll}
                className="mb-2 text-xs font-medium text-accent underline hover:text-accent-hover"
                data-testid="af-team-select-all"
              >
                {allFetchedSelected ? "Deselect All" : "Select All"}
              </button>
            )}

            <fieldset>
              <legend className="sr-only">Teachers Present</legend>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {teachers.length === 0 ? (
                  <p className="text-sm text-text-muted">No teachers found</p>
                ) : (
                  teachers.map((teacher) => {
                    const tid = Number(teacher.id);
                    const isChecked = selectedTeacherIds.has(tid);
                    return (
                      <label key={tid} className="flex items-center gap-2 cursor-pointer text-sm text-text-primary">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleTeacherToggle(tid, e.target.checked)}
                          className="h-4 w-4 accent-accent"
                          data-testid={`af-team-teacher-${tid}`}
                        />
                        {getTeacherDisplayName(teacher)}
                      </label>
                    );
                  })
                )}
              </div>
            </fieldset>
          </>
        )}
      </section>

      {/* Gating message */}
      {!hasTeachers && !hasExistingAnswers && !disabled && !teachersLoading && !teachersError && (
        <p className="text-sm text-text-muted px-1" data-testid="af-team-select-teacher-prompt">
          Select at least one teacher to begin.
        </p>
      )}

      {/* Progress bar + questions */}
      {showQuestions && (
        <>
          <div
            className="sticky top-12 z-10 border-2 border-border-accent bg-bg-card-alt px-3 py-2"
            data-testid="af-team-progress"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
              <span className="font-mono font-bold text-accent">
                Teachers: {teacherCount}
              </span>
              <span className="font-mono">
                Answered: {answeredCount}/{AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.length}
              </span>
            </div>
          </div>

          {AF_TEAM_INTERACTION_CONFIG.sections.map((section) => (
            <section key={section.title} className="border border-border p-4 space-y-4">
              <h3 className="text-sm font-semibold text-text-primary uppercase">{section.title}</h3>

              {section.questions.map((question) => {
                const entry = questions[question.key];
                const answer = entry?.answer ?? null;
                const remark = typeof entry?.remark === "string" ? entry.remark : "";
                const remarkVisible = remark.length > 0 || revealedRemarks.has(question.key);

                return (
                  <div key={question.key}>
                    <fieldset disabled={disabled}>
                      <legend className="sr-only">{question.label}</legend>
                      <p className="mb-2 text-sm text-text-primary">{question.label}</p>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                          <input
                            type="radio"
                            name={`af-team-${question.key}`}
                            checked={answer === true}
                            onChange={() => handleAnswerChange(question.key, true)}
                            disabled={disabled}
                            className="h-4 w-4 accent-accent"
                            data-testid={`af-team-${question.key}-yes`}
                          />
                          Yes
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                          <input
                            type="radio"
                            name={`af-team-${question.key}`}
                            checked={answer === false}
                            onChange={() => handleAnswerChange(question.key, false)}
                            disabled={disabled}
                            className="h-4 w-4 accent-accent"
                            data-testid={`af-team-${question.key}-no`}
                          />
                          No
                        </label>
                      </div>
                    </fieldset>

                    {!remarkVisible && !disabled && (
                      <button
                        type="button"
                        onClick={() => {
                          setRevealedRemarks((current) => new Set(current).add(question.key));
                        }}
                        className="mt-2 text-xs font-medium text-accent underline hover:text-accent-hover"
                      >
                        Add remark
                      </button>
                    )}

                    {remarkVisible && (
                      <label className="mt-2 block">
                        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">Remark</span>
                        <textarea
                          rows={2}
                          value={remark}
                          disabled={disabled}
                          onChange={(e) => handleRemarkChange(question.key, e.target.value)}
                          placeholder="Optional remark"
                          className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-bg-card-alt"
                          data-testid={`af-team-${question.key}-remark`}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
