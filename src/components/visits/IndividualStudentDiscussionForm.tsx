"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  VALID_GRADES,
  type IndividualStudentEntry,
} from "@/lib/individual-student-discussion";
import { getStudentDisplayName, type Student } from "@/lib/student-utils";

interface IndividualStudentDiscussionFormProps {
  data: Record<string, unknown>;
  setData: Dispatch<SetStateAction<Record<string, unknown>>>;
  disabled: boolean;
  schoolCode: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStudentEntriesFromData(data: Record<string, unknown>): IndividualStudentEntry[] {
  if (!Array.isArray(data.students)) return [];
  return data.students.filter(
    (s): s is IndividualStudentEntry =>
      isPlainObject(s) &&
      typeof s.id === "number" &&
      typeof s.name === "string"
  );
}

function getQuestionProgress(entry: IndividualStudentEntry): string {
  const total = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.length;
  let answered = 0;
  const questions = entry.questions ?? {};
  for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
    const q = questions[key];
    if (q && typeof q.answer === "boolean") answered++;
  }
  return `${answered}/${total}`;
}

export default function IndividualStudentDiscussionForm({
  data,
  setData,
  disabled,
  schoolCode,
}: IndividualStudentDiscussionFormProps) {
  const [availableStudents, setAvailableStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [revealedRemarks, setRevealedRemarks] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (selectedGrade === null) {
      setAvailableStudents([]);
      return;
    }

    let cancelled = false;

    async function fetchStudents() {
      setStudentsLoading(true);
      setStudentsError(null);
      try {
        const response = await fetch(
          `/api/pm/students?school_code=${encodeURIComponent(schoolCode)}&grade=${selectedGrade}`
        );
        if (!response.ok) throw new Error("Failed to load students");
        const body = await response.json();
        if (!cancelled) {
          setAvailableStudents(Array.isArray(body.students) ? body.students : []);
        }
      } catch {
        if (!cancelled) setStudentsError("Failed to load students");
      } finally {
        if (!cancelled) setStudentsLoading(false);
      }
    }

    void fetchStudents();
    return () => { cancelled = true; };
  }, [schoolCode, selectedGrade]);

  const recordedStudents = getStudentEntriesFromData(data);
  const recordedStudentIds = useMemo(
    () => new Set(recordedStudents.map((s) => s.id)),
    [recordedStudents]
  );

  const remainingStudents = useMemo(
    () => availableStudents.filter((s) => !recordedStudentIds.has(Number(s.id))),
    [availableStudents, recordedStudentIds]
  );

  const availableStudentsRef = useRef(availableStudents);
  availableStudentsRef.current = availableStudents;

  const selectedGradeRef = useRef(selectedGrade);
  selectedGradeRef.current = selectedGrade;

  const toggleSection = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddStudent = useCallback(
    (studentId: number) => {
      const student = availableStudentsRef.current.find((s) => Number(s.id) === studentId);
      if (!student) return;
      const name = getStudentDisplayName(student);
      const grade = selectedGradeRef.current;

      setData((current) => {
        const entries = getStudentEntriesFromData(current);
        const newEntry: IndividualStudentEntry = {
          id: Number(student.id),
          name,
          grade: grade ?? 11,
          questions: {},
        };
        return { ...current, students: [...entries, newEntry] };
      });

      setExpandedIds((prev) => new Set(prev).add(Number(student.id)));
    },
    [setData]
  );

  const handleRemoveStudent = useCallback(
    (studentId: number) => {
      setData((current) => {
        const entries = getStudentEntriesFromData(current);
        return { ...current, students: entries.filter((s) => s.id !== studentId) };
      });
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    },
    [setData]
  );

  const handleAnswerChange = useCallback(
    (studentId: number, questionKey: string, answer: boolean) => {
      setData((current) => {
        const entries = getStudentEntriesFromData(current);
        return {
          ...current,
          students: entries.map((s) => {
            if (s.id !== studentId) return s;
            const questions = { ...s.questions };
            const existing = isPlainObject(questions[questionKey])
              ? { ...(questions[questionKey] as Record<string, unknown>) }
              : {};
            questions[questionKey] = { ...existing, answer } as { answer: boolean | null; remark?: string };
            return { ...s, questions };
          }),
        };
      });
    },
    [setData]
  );

  const handleRemarkChange = useCallback(
    (studentId: number, questionKey: string, remark: string) => {
      setData((current) => {
        const entries = getStudentEntriesFromData(current);
        return {
          ...current,
          students: entries.map((s) => {
            if (s.id !== studentId) return s;
            const questions = { ...s.questions };
            const existing = isPlainObject(questions[questionKey])
              ? { ...(questions[questionKey] as Record<string, unknown>) }
              : {};
            questions[questionKey] = { ...existing, remark } as { answer: boolean | null; remark?: string };
            return { ...s, questions };
          }),
        };
      });
    },
    [setData]
  );

  return (
    <div className="space-y-4" data-testid="action-renderer-individual_student_discussion">
      {/* Grade filter + Student select */}
      {!disabled && (
        <div className="flex flex-wrap items-end gap-3 border border-border p-4">
          <div>
            <label className="block text-sm font-semibold text-text-primary uppercase mb-2">
              Grade
            </label>
            <select
              value={selectedGrade ?? ""}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSelectedGrade(val || null);
              }}
              className="border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              data-testid="student-grade-filter"
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

          {selectedGrade !== null && !studentsLoading && !studentsError && remainingStudents.length > 0 && (
            <div>
              <select
                className="border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                data-testid="add-student-select"
                defaultValue=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) handleAddStudent(id);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Add Student...
                </option>
                {remainingStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {getStudentDisplayName(s)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Loading / error states */}
      {studentsLoading && !disabled && (
        <p className="text-sm text-text-muted" data-testid="individual-student-loading">
          Loading students...
        </p>
      )}

      {studentsError && !disabled && (
        <p className="text-sm text-danger" data-testid="individual-student-error">
          {studentsError}
        </p>
      )}

      {/* Progress bar */}
      {recordedStudents.length > 0 && (
        <div
          className="sticky top-12 z-10 border-2 border-border-accent bg-bg-card-alt px-3 py-2"
          data-testid="individual-student-progress"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
            <span className="font-mono font-bold text-accent">
              Students: {recordedStudents.length}
            </span>
          </div>
        </div>
      )}

      {/* Student sections */}
      {recordedStudents.map((entry) => {
        const isExpanded = expandedIds.has(entry.id);
        const progress = getQuestionProgress(entry);

        return (
          <div
            key={entry.id}
            className="border border-border"
            data-testid={`student-section-${entry.id}`}
          >
            {/* Header — always visible */}
            <button
              type="button"
              onClick={() => toggleSection(entry.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-bg-card-alt"
              data-testid={`student-header-${entry.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-text-primary">
                  {entry.name || `Student #${entry.id}`}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800"
                  data-testid={`student-grade-badge-${entry.id}`}
                >
                  Grade {entry.grade}
                </span>
                <span className="text-xs text-text-muted" data-testid={`student-progress-${entry.id}`}>
                  {progress}
                </span>
              </div>
              <span className="text-text-muted">
                {isExpanded ? "▾" : "▸"}
              </span>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-border px-4 py-3 space-y-4">
                {disabled ? (
                  /* Read-only mode */
                  <div className="space-y-3">
                    {INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.sections.map((section) => (
                      <div key={section.title} className="space-y-2">
                        <h4 className="text-xs font-semibold text-text-muted uppercase">{section.title}</h4>
                        {section.questions.map((question) => {
                          const q = entry.questions?.[question.key];
                          const answer = q?.answer;
                          const remark = typeof q?.remark === "string" ? q.remark : "";
                          return (
                            <div key={question.key} className="text-sm text-text-primary">
                              <p>{question.label}</p>
                              <p className="text-text-muted">
                                {answer === true ? "Yes" : answer === false ? "No" : "—"}
                                {remark && ` | ${remark}`}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Editable mode */
                  <>
                    {INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.sections.map((section) => (
                      <section key={section.title} className="border border-border p-4 space-y-4">
                        <h4 className="text-sm font-semibold text-text-primary uppercase">{section.title}</h4>
                        {section.questions.map((question) => {
                          const q = entry.questions?.[question.key];
                          const answer = q?.answer ?? null;
                          const remark = typeof q?.remark === "string" ? q.remark : "";
                          const remarkKey = `${entry.id}-${question.key}`;
                          const remarkVisible = remark.length > 0 || revealedRemarks.has(remarkKey);

                          return (
                            <div key={question.key}>
                              <fieldset>
                                <legend className="sr-only">{question.label}</legend>
                                <p className="mb-2 text-sm text-text-primary">{question.label}</p>
                                <div className="flex items-center gap-4">
                                  <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                                    <input
                                      type="radio"
                                      name={`student-${entry.id}-${question.key}`}
                                      checked={answer === true}
                                      onChange={() => handleAnswerChange(entry.id, question.key, true)}
                                      className="h-4 w-4 accent-accent"
                                      data-testid={`student-${entry.id}-${question.key}-yes`}
                                    />
                                    Yes
                                  </label>
                                  <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                                    <input
                                      type="radio"
                                      name={`student-${entry.id}-${question.key}`}
                                      checked={answer === false}
                                      onChange={() => handleAnswerChange(entry.id, question.key, false)}
                                      className="h-4 w-4 accent-accent"
                                      data-testid={`student-${entry.id}-${question.key}-no`}
                                    />
                                    No
                                  </label>
                                </div>
                              </fieldset>

                              {!remarkVisible && (
                                <button
                                  type="button"
                                  onClick={() => setRevealedRemarks((prev) => new Set(prev).add(remarkKey))}
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
                                    onChange={(e) => handleRemarkChange(entry.id, question.key, e.target.value)}
                                    placeholder="Optional remark"
                                    className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                                    data-testid={`student-${entry.id}-${question.key}-remark`}
                                  />
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </section>
                    ))}

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => handleRemoveStudent(entry.id)}
                      className="text-sm font-medium text-danger underline hover:text-danger/80"
                      data-testid={`remove-student-${entry.id}`}
                    >
                      Remove Student
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
