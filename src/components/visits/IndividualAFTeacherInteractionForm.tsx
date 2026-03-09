"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  ATTENDANCE_OPTIONS,
  INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG,
  type Attendance,
  type IndividualTeacherEntry,
} from "@/lib/individual-af-teacher-interaction";
import { getTeacherDisplayName, type Teacher } from "@/lib/teacher-utils";

interface IndividualAFTeacherInteractionFormProps {
  data: Record<string, unknown>;
  setData: Dispatch<SetStateAction<Record<string, unknown>>>;
  disabled: boolean;
  schoolCode: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getTeacherEntriesFromData(data: Record<string, unknown>): IndividualTeacherEntry[] {
  if (!Array.isArray(data.teachers)) return [];
  return data.teachers.filter(
    (t): t is IndividualTeacherEntry =>
      isPlainObject(t) &&
      typeof t.id === "number" &&
      typeof t.name === "string" &&
      typeof t.attendance === "string"
  );
}

const ATTENDANCE_LABELS: Record<Attendance, string> = {
  present: "Present",
  on_leave: "On Leave",
  absent: "Absent",
};

const ATTENDANCE_BADGE_CLASSES: Record<Attendance, string> = {
  present: "bg-green-100 text-green-800",
  on_leave: "bg-yellow-100 text-yellow-800",
  absent: "bg-gray-100 text-gray-600",
};

function getQuestionProgress(entry: IndividualTeacherEntry): string {
  if (entry.attendance !== "present") return "N/A";
  const total = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys.length;
  let answered = 0;
  const questions = entry.questions ?? {};
  for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
    const q = questions[key];
    if (q && typeof q.answer === "boolean") answered++;
  }
  return `${answered}/${total}`;
}

export default function IndividualAFTeacherInteractionForm({
  data,
  setData,
  disabled,
  schoolCode,
}: IndividualAFTeacherInteractionFormProps) {
  const [availableTeachers, setAvailableTeachers] = useState<Teacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [revealedRemarks, setRevealedRemarks] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    async function fetchTeachers() {
      setTeachersLoading(true);
      setTeachersError(null);
      try {
        const response = await fetch(`/api/pm/teachers?school_code=${encodeURIComponent(schoolCode)}`);
        if (!response.ok) throw new Error("Failed to load teachers");
        const body = await response.json();
        if (!cancelled) {
          setAvailableTeachers(Array.isArray(body.teachers) ? body.teachers : []);
        }
      } catch {
        if (!cancelled) setTeachersError("Failed to load teachers");
      } finally {
        if (!cancelled) setTeachersLoading(false);
      }
    }

    void fetchTeachers();
    return () => { cancelled = true; };
  }, [schoolCode]);

  const recordedTeachers = getTeacherEntriesFromData(data);
  const recordedTeacherIds = useMemo(
    () => new Set(recordedTeachers.map((t) => t.id)),
    [recordedTeachers]
  );

  const remainingTeachers = useMemo(
    () => availableTeachers.filter((t) => !recordedTeacherIds.has(Number(t.id))),
    [availableTeachers, recordedTeacherIds]
  );

  const allTeachersRecorded = useMemo(
    () => availableTeachers.length > 0 && availableTeachers.every((t) => recordedTeacherIds.has(Number(t.id))),
    [availableTeachers, recordedTeacherIds]
  );

  const availableTeachersRef = useRef(availableTeachers);
  availableTeachersRef.current = availableTeachers;

  const toggleSection = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddTeacher = useCallback(
    (teacherId: number) => {
      const teacher = availableTeachersRef.current.find((t) => Number(t.id) === teacherId);
      if (!teacher) return;
      const name = getTeacherDisplayName(teacher);

      setData((current) => {
        const entries = getTeacherEntriesFromData(current);
        const newEntry: IndividualTeacherEntry = {
          id: Number(teacher.id),
          name,
          attendance: "present",
          questions: {},
        };
        return { ...current, teachers: [...entries, newEntry] };
      });

      setExpandedIds((prev) => new Set(prev).add(Number(teacher.id)));
    },
    [setData]
  );

  const handleRemoveTeacher = useCallback(
    (teacherId: number) => {
      setData((current) => {
        const entries = getTeacherEntriesFromData(current);
        return { ...current, teachers: entries.filter((t) => t.id !== teacherId) };
      });
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(teacherId);
        return next;
      });
    },
    [setData]
  );

  const handleAttendanceChange = useCallback(
    (teacherId: number, attendance: Attendance) => {
      setData((current) => {
        const entries = getTeacherEntriesFromData(current);
        return {
          ...current,
          teachers: entries.map((t) => {
            if (t.id !== teacherId) return t;
            if (attendance !== "present") {
              return { ...t, attendance, questions: {} };
            }
            return { ...t, attendance, questions: t.questions };
          }),
        };
      });
    },
    [setData]
  );

  const handleAnswerChange = useCallback(
    (teacherId: number, questionKey: string, answer: boolean) => {
      setData((current) => {
        const entries = getTeacherEntriesFromData(current);
        return {
          ...current,
          teachers: entries.map((t) => {
            if (t.id !== teacherId) return t;
            const questions = { ...t.questions };
            const existing = isPlainObject(questions[questionKey])
              ? { ...(questions[questionKey] as Record<string, unknown>) }
              : {};
            questions[questionKey] = { ...existing, answer } as { answer: boolean | null; remark?: string };
            return { ...t, questions };
          }),
        };
      });
    },
    [setData]
  );

  const handleRemarkChange = useCallback(
    (teacherId: number, questionKey: string, remark: string) => {
      setData((current) => {
        const entries = getTeacherEntriesFromData(current);
        return {
          ...current,
          teachers: entries.map((t) => {
            if (t.id !== teacherId) return t;
            const questions = { ...t.questions };
            const existing = isPlainObject(questions[questionKey])
              ? { ...(questions[questionKey] as Record<string, unknown>) }
              : {};
            questions[questionKey] = { ...existing, remark } as { answer: boolean | null; remark?: string };
            return { ...t, questions };
          }),
        };
      });
    },
    [setData]
  );

  // Progress stats
  const stats = useMemo(() => {
    let presentCount = 0;
    let onLeaveCount = 0;
    let absentCount = 0;
    for (const t of recordedTeachers) {
      if (t.attendance === "present") presentCount++;
      else if (t.attendance === "on_leave") onLeaveCount++;
      else if (t.attendance === "absent") absentCount++;
    }
    return {
      recorded: recordedTeachers.length,
      total: availableTeachers.length,
      presentCount,
      onLeaveCount,
      absentCount,
    };
  }, [recordedTeachers, availableTeachers]);

  return (
    <div className="space-y-4" data-testid="action-renderer-individual_af_teacher_interaction">
      {/* Progress bar */}
      {!teachersLoading && !teachersError && (
        <div
          className="sticky top-2 z-10 border-2 border-border-accent bg-bg-card-alt px-3 py-2"
          data-testid="individual-teacher-progress"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
            <span className="font-mono font-bold text-accent">
              Recorded: {stats.recorded}/{stats.total} teachers
            </span>
            <span className="font-mono">
              {stats.presentCount} present, {stats.onLeaveCount} on leave, {stats.absentCount} absent
            </span>
          </div>
        </div>
      )}

      {/* Teacher sections */}
      {recordedTeachers.map((entry) => {
        const isExpanded = disabled ? expandedIds.has(entry.id) : expandedIds.has(entry.id);
        const progress = getQuestionProgress(entry);

        return (
          <div
            key={entry.id}
            className="border border-border"
            data-testid={`teacher-section-${entry.id}`}
          >
            {/* Header — always visible */}
            <button
              type="button"
              onClick={() => toggleSection(entry.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-bg-card-alt"
              data-testid={`teacher-header-${entry.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-text-primary">
                  {entry.name || `Teacher #${entry.id}`}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${ATTENDANCE_BADGE_CLASSES[entry.attendance] ?? "bg-gray-100 text-gray-600"}`}
                  data-testid={`teacher-badge-${entry.id}`}
                >
                  {ATTENDANCE_LABELS[entry.attendance] ?? entry.attendance}
                </span>
                <span className="text-xs text-text-muted" data-testid={`teacher-progress-${entry.id}`}>
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
                    <p className="text-sm text-text-primary">
                      <span className="font-medium">Attendance:</span>{" "}
                      {ATTENDANCE_LABELS[entry.attendance] ?? entry.attendance}
                    </p>
                    {entry.attendance === "present" &&
                      INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.sections.map((section) => (
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
                    {/* Attendance radios */}
                    <fieldset>
                      <legend className="mb-2 text-sm font-semibold text-text-primary uppercase">Attendance</legend>
                      <div className="flex items-center gap-4">
                        {ATTENDANCE_OPTIONS.map((opt) => (
                          <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                            <input
                              type="radio"
                              name={`teacher-${entry.id}-attendance`}
                              checked={entry.attendance === opt}
                              onChange={() => handleAttendanceChange(entry.id, opt)}
                              className="h-4 w-4 accent-accent"
                              data-testid={`teacher-${entry.id}-attendance-${opt}`}
                            />
                            {ATTENDANCE_LABELS[opt]}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {/* Questions — only for present */}
                    {entry.attendance === "present" &&
                      INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.sections.map((section) => (
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
                                        name={`teacher-${entry.id}-${question.key}`}
                                        checked={answer === true}
                                        onChange={() => handleAnswerChange(entry.id, question.key, true)}
                                        className="h-4 w-4 accent-accent"
                                        data-testid={`teacher-${entry.id}-${question.key}-yes`}
                                      />
                                      Yes
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-primary">
                                      <input
                                        type="radio"
                                        name={`teacher-${entry.id}-${question.key}`}
                                        checked={answer === false}
                                        onChange={() => handleAnswerChange(entry.id, question.key, false)}
                                        className="h-4 w-4 accent-accent"
                                        data-testid={`teacher-${entry.id}-${question.key}-no`}
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
                                      data-testid={`teacher-${entry.id}-${question.key}-remark`}
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
                      onClick={() => handleRemoveTeacher(entry.id)}
                      className="text-sm font-medium text-danger underline hover:text-danger/80"
                      data-testid={`remove-teacher-${entry.id}`}
                    >
                      Remove Teacher
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Add teacher / all teachers recorded */}
      {!disabled && !teachersLoading && !teachersError && (
        <>
          {allTeachersRecorded ? (
            <p
              className="text-sm font-medium text-green-700 px-1"
              data-testid="all-teachers-recorded"
            >
              All teachers recorded
            </p>
          ) : remainingTeachers.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                className="border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                data-testid="add-teacher-select"
                defaultValue=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) handleAddTeacher(id);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Add Teacher...
                </option>
                {remainingTeachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {getTeacherDisplayName(t)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      )}

      {/* Loading / error states */}
      {teachersLoading && !disabled && (
        <p className="text-sm text-text-muted" data-testid="individual-teacher-loading">
          Loading teachers...
        </p>
      )}

      {teachersError && !disabled && (
        <p className="text-sm text-danger" data-testid="individual-teacher-error">
          {teachersError}
        </p>
      )}
    </div>
  );
}
