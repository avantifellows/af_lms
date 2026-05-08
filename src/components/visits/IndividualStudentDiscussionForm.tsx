"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { fuzzyMatch } from "@/lib/fuzzy-match";
import {
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  VALID_GRADES,
  type IndividualStudentEntry,
} from "@/lib/individual-student-discussion";
import { getStudentDisplayName, type Student } from "@/lib/student-utils";
import { isPlainObject } from "@/lib/visit-form-utils";
import { FormSection, RadioPair, Select, StickyProgressBar } from "@/components/ui";

interface IndividualStudentDiscussionFormProps {
  data: Record<string, unknown>;
  setData: Dispatch<SetStateAction<Record<string, unknown>>>;
  disabled: boolean;
  schoolCode: string;
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

/* -- Multi-select student dropdown --------------------------------------- */

interface MultiSelectStudentSearchProps {
  students: Student[];
  onAddStudents: (students: Student[]) => void;
}

function MultiSelectStudentSearch({ students, onAddStudents }: MultiSelectStudentSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const filtered = useMemo(() => {
    if (query.trim() === "") return students;
    return students.filter(
      (s) =>
        fuzzyMatch(query, getStudentDisplayName(s)) ||
        fuzzyMatch(query, s.student_id)
    );
  }, [students, query]);

  const selectedStudents = useMemo(
    () => students.filter((s) => checkedIds.has(Number(s.id))),
    [students, checkedIds]
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((student) => checkedIds.has(Number(student.id)));

  useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  function focusTrigger() {
    triggerRef.current?.focus();
  }

  function resetAndClose() {
    setCheckedIds(new Set());
    setQuery("");
    setIsOpen(false);
    focusTrigger();
  }

  function handleAddSelected() {
    if (checkedIds.size === 0) return;
    onAddStudents(selectedStudents);
    resetAndClose();
  }

  function toggleStudent(studentId: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function toggleVisibleStudents() {
    if (filtered.length === 0) return;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const student of filtered) next.delete(Number(student.id));
      } else {
        for (const student of filtered) next.add(Number(student.id));
      }
      return next;
    });
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSelected();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      resetAndClose();
    }
  }

  return (
    <div ref={containerRef} className="relative" data-testid="student-search-container">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="min-h-[44px] w-56 rounded-lg border-2 border-border px-3 py-2.5 text-left text-sm text-text-primary transition-colors hover:bg-bg-card-alt focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        data-testid="multi-select-student-trigger"
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        Add students
      </button>
      {isOpen && (
        <div
          id={panelId}
          role="group"
          aria-label="Student selection"
          data-testid="multi-select-student-panel"
          className="absolute z-20 mt-1 w-80 border-2 border-border bg-bg-card shadow-md"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              resetAndClose();
            }
          }}
        >
          <div className="space-y-2 border-b border-border p-3">
            <button
              type="button"
              onClick={toggleVisibleStudents}
              disabled={filtered.length === 0}
              className="text-sm font-semibold text-accent disabled:cursor-not-allowed disabled:text-text-muted"
              data-testid="select-all-students"
            >
              {allVisibleSelected ? "Deselect All" : "Select All"}
            </button>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search students..."
              className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              data-testid="multi-select-student-search"
            />
          </div>
          <fieldset className="max-h-60 overflow-y-auto p-2">
            <legend className="sr-only">Students</legend>
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-text-muted">No matches</p>
            ) : (
              filtered.map((student) => {
                const studentId = Number(student.id);
                return (
                  <label
                    key={student.id}
                    className="flex cursor-pointer items-center gap-2 px-2 py-2 text-sm text-text-primary hover:bg-bg-card-alt"
                  >
                    <input
                      type="checkbox"
                      checked={checkedIds.has(studentId)}
                      onChange={() => toggleStudent(studentId)}
                      data-testid={`student-checkbox-${studentId}`}
                      className="h-4 w-4"
                    />
                    <span>{getStudentDisplayName(student)}</span>
                  </label>
                );
              })
            )}
          </fieldset>
          <div className="sticky bottom-0 border-t border-border bg-bg-card p-3">
            <button
              type="button"
              onClick={handleAddSelected}
              disabled={selectedStudents.length === 0}
              className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-border disabled:text-text-muted"
              data-testid="add-selected-students"
            >
              Add Selected ({selectedStudents.length})
            </button>
          </div>
        </div>
      )}
    </div>
  );
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

  const handleAddStudents = useCallback(
    (students: Student[]) => {
      if (students.length === 0) return;

      const currentIds = new Set(getStudentEntriesFromData(data).map((student) => student.id));
      const studentsToAdd = students.filter((student) => !currentIds.has(Number(student.id)));
      if (studentsToAdd.length === 0) return;

      const grade = selectedGradeRef.current;

      setData((current) => {
        const entries = getStudentEntriesFromData(current);
        const existingIds = new Set(entries.map((student) => student.id));
        const newEntries: IndividualStudentEntry[] = studentsToAdd
          .filter((student) => !existingIds.has(Number(student.id)))
          .map((student) => ({
            id: Number(student.id),
            name: getStudentDisplayName(student),
            grade: grade ?? 11,
            questions: {},
          }));
        if (newEntries.length === 0) return current;
        return { ...current, students: [...entries, ...newEntries] };
      });

      if (studentsToAdd.length === 1) {
        setExpandedIds((prev) => new Set(prev).add(Number(studentsToAdd[0].id)));
      }
    },
    [data, setData]
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
      {/* Grade filter + student picker */}
      {!disabled && (
        <FormSection spacing="" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-semibold text-text-primary uppercase mb-2">
              Grade
            </label>
            <Select
              value={selectedGrade ?? ""}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSelectedGrade(val || null);
              }}
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
            </Select>
          </div>

          {selectedGrade !== null && !studentsLoading && !studentsError && remainingStudents.length > 0 && (
            <MultiSelectStudentSearch
              key={selectedGrade}
              students={remainingStudents}
              onAddStudents={handleAddStudents}
            />
          )}
        </FormSection>
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
        <StickyProgressBar
          data-testid="individual-student-progress"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
            <span className="font-mono font-bold text-accent">
              Students: {recordedStudents.length}
            </span>
          </div>
        </StickyProgressBar>
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
                  className="rounded-full px-2 py-0.5 text-xs font-medium bg-hover-bg text-accent-hover"
                  data-testid={`student-grade-badge-${entry.id}`}
                >
                  Grade {entry.grade}
                </span>
                <span className="text-xs text-text-muted" data-testid={`student-progress-${entry.id}`}>
                  {progress}
                </span>
              </div>
              <span className="text-text-muted">
                {isExpanded ? "\u25BE" : "\u25B8"}
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
                                {answer === true ? "Yes" : answer === false ? "No" : "\u2014"}
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
                      <FormSection key={section.title}>
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
                                <RadioPair
                                  name={`student-${entry.id}-${question.key}`}
                                  value={answer}
                                  onChange={(val) => handleAnswerChange(entry.id, question.key, val)}
                                  yesTestId={`student-${entry.id}-${question.key}-yes`}
                                  noTestId={`student-${entry.id}-${question.key}-no`}
                                />
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
                      </FormSection>
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
