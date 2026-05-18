"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { fuzzyMatch } from "@/lib/fuzzy-match";
import {
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  VALID_GRADES,
  getEntriesFromData,
  type IndividualStudentDiscussionEntry,
  type IndividualStudentRef,
  type ValidGrade,
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

function getQuestionProgress(entry: IndividualStudentDiscussionEntry): string {
  const total = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.length;
  let answered = 0;
  const questions = entry.questions ?? {};
  for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
    const q = questions[key];
    if (q && typeof q.answer === "boolean") answered++;
  }
  return `${answered}/${total}`;
}

function getStudentCount(entries: IndividualStudentDiscussionEntry[]): number {
  return entries.reduce((total, entry) => total + entry.students.length, 0);
}

function getStackedStudentNames(students: IndividualStudentRef[]): string[] {
  const visible = students.slice(0, 5).map((student) => student.name || `Student #${student.id}`);
  const hiddenCount = students.length - visible.length;
  return hiddenCount > 0 ? [...visible, `+${hiddenCount} more`] : visible;
}

function parseGrade(value: string): ValidGrade | null {
  const grade = Number(value);
  return (VALID_GRADES as readonly number[]).includes(grade) ? (grade as ValidGrade) : null;
}

/* -- Searchable multi-select picker -------------------------------------- */

interface SearchableStudentSelectProps {
  students: Student[];
  disabled: boolean;
  onToggle: (id: number) => void;
  emptyMessage: string;
}

function SearchableStudentSelect({
  students,
  disabled,
  onToggle,
  emptyMessage,
}: SearchableStudentSelectProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (query.trim() === "") return students;
    return students.filter(
      (s) =>
        fuzzyMatch(query, getStudentDisplayName(s)) ||
        (s.student_id !== null && fuzzyMatch(query, s.student_id))
    );
  }, [students, query]);

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative" data-testid="student-search-container">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => !disabled && setIsOpen(true)}
        onClick={() => !disabled && setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Select grade first" : "Search students..."}
        className="border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none w-56"
        data-testid="add-student-select"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls="student-search-listbox"
        autoComplete="off"
        disabled={disabled}
      />
      {isOpen && !disabled && (
        <ul
          id="student-search-listbox"
          data-testid="student-search-listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto border-2 border-border bg-bg-card shadow-md"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">
              {query.trim() === "" ? emptyMessage : "No matches"}
            </li>
          ) : (
            filtered.map((s) => (
              <li
                key={s.id}
                data-testid={`student-option-${s.id}`}
                className="px-3 py-2 text-sm text-text-primary hover:bg-bg-card-alt"
              >
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid={`student-checkbox-${s.id}`}
                    onChange={() => {
                      onToggle(Number(s.id));
                      setQuery("");
                      setIsOpen(true);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  />
                  <span>{getStudentDisplayName(s)}</span>
                </label>
              </li>
            ))
          )}
        </ul>
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
  const [selectedGrade, setSelectedGrade] = useState<ValidGrade | null>(null);
  const [pendingStudentIds, setPendingStudentIds] = useState<number[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
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

  const entries = getEntriesFromData(data);
  const recordedStudentIds = useMemo(
    () => new Set(entries.flatMap((entry) => entry.students.map((student) => student.id))),
    [entries]
  );
  const pendingStudentIdSet = useMemo(
    () => new Set(pendingStudentIds),
    [pendingStudentIds]
  );

  const remainingStudents = useMemo(
    () =>
      availableStudents.filter(
        (s) => !recordedStudentIds.has(Number(s.id)) && !pendingStudentIdSet.has(Number(s.id))
      ),
    [availableStudents, pendingStudentIdSet, recordedStudentIds]
  );

  const pendingStudents = useMemo(
    () =>
      pendingStudentIds
        .map((id) => availableStudents.find((student) => Number(student.id) === id))
        .filter((student): student is Student => student !== undefined),
    [availableStudents, pendingStudentIds]
  );

  const availableStudentsRef = useRef(availableStudents);
  availableStudentsRef.current = availableStudents;

  const selectedGradeRef = useRef(selectedGrade);
  selectedGradeRef.current = selectedGrade;

  const toggleSection = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleTogglePendingStudent = useCallback((studentId: number) => {
    setPendingStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  }, []);

  const handleRemovePendingStudent = useCallback((studentId: number) => {
    setPendingStudentIds((current) => current.filter((id) => id !== studentId));
  }, []);

  const handleAddEntry = useCallback(
    () => {
      const grade = selectedGradeRef.current;
      if (grade === null || pendingStudentIds.length === 0) return;

      const selectedStudents = pendingStudentIds
        .map((id) => availableStudentsRef.current.find((student) => Number(student.id) === id))
        .filter((student): student is Student => student !== undefined);
      if (selectedStudents.length === 0) return;

      const entryId = globalThis.crypto.randomUUID();
      const students: IndividualStudentRef[] = selectedStudents.map((student) => ({
        id: Number(student.id),
        name: getStudentDisplayName(student),
      }));

      setPendingStudentIds([]);
      setData((current) => {
        const currentEntries = getEntriesFromData(current);
        const newEntry: IndividualStudentDiscussionEntry = {
          id: entryId,
          grade,
          students,
          questions: {},
        };
        return { ...current, entries: [...currentEntries, newEntry] };
      });

      setExpandedIds((prev) => new Set(prev).add(entryId));
    },
    [pendingStudentIds, setData]
  );

  const handleRemoveEntry = useCallback(
    (entryId: string) => {
      setData((current) => {
        const currentEntries = getEntriesFromData(current);
        return { ...current, entries: currentEntries.filter((entry) => entry.id !== entryId) };
      });
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    },
    [setData]
  );

  const handleAnswerChange = useCallback(
    (entryId: string, questionKey: string, answer: boolean) => {
      setData((current) => {
        const currentEntries = getEntriesFromData(current);
        return {
          ...current,
          entries: currentEntries.map((entry) => {
            if (entry.id !== entryId) return entry;
            const questions = { ...entry.questions };
            const existing = isPlainObject(questions[questionKey])
              ? { ...(questions[questionKey] as Record<string, unknown>) }
              : {};
            questions[questionKey] = { ...existing, answer } as { answer: boolean | null; remark?: string };
            return { ...entry, questions };
          }),
        };
      });
    },
    [setData]
  );

  const handleRemarkChange = useCallback(
    (entryId: string, questionKey: string, remark: string) => {
      setData((current) => {
        const currentEntries = getEntriesFromData(current);
        return {
          ...current,
          entries: currentEntries.map((entry) => {
            if (entry.id !== entryId) return entry;
            const questions = { ...entry.questions };
            const existing = isPlainObject(questions[questionKey])
              ? { ...(questions[questionKey] as Record<string, unknown>) }
              : {};
            questions[questionKey] = { ...existing, remark } as { answer: boolean | null; remark?: string };
            return { ...entry, questions };
          }),
        };
      });
    },
    [setData]
  );

  return (
    <div className="space-y-4" data-testid="action-renderer-individual_student_discussion">
      {/* Grade filter + pending student selection */}
      {!disabled && (
        <FormSection spacing="" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-semibold text-text-primary uppercase mb-2">
              Grade
            </label>
            <Select
              value={selectedGrade ?? ""}
              onChange={(e) => {
                setSelectedGrade(parseGrade(e.target.value));
                setPendingStudentIds([]);
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

          {!studentsLoading && !studentsError && (
            <SearchableStudentSelect
              students={remainingStudents}
              disabled={selectedGrade === null}
              onToggle={handleTogglePendingStudent}
              emptyMessage="No students in this grade"
            />
          )}

          <button
            type="button"
            onClick={handleAddEntry}
            disabled={selectedGrade === null || pendingStudentIds.length === 0}
            className="min-h-[44px] border-2 border-accent px-4 py-2 text-sm font-semibold text-accent disabled:cursor-not-allowed disabled:border-border disabled:text-text-muted hover:bg-hover-bg"
            data-testid="add-individual-student-entry"
          >
            Add Entry
          </button>
          </div>

          {pendingStudents.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="pending-student-chips">
              {pendingStudents.map((student) => (
                <span
                  key={student.id}
                  className="inline-flex items-center gap-2 border border-border bg-bg-card-alt px-2 py-1 text-sm text-text-primary"
                  data-testid={`pending-student-chip-${student.id}`}
                >
                  {getStudentDisplayName(student)}
                  <button
                    type="button"
                    onClick={() => handleRemovePendingStudent(Number(student.id))}
                    className="text-text-muted hover:text-danger"
                    aria-label={`Remove ${getStudentDisplayName(student)}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
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
      {entries.length > 0 && (
        <StickyProgressBar
          data-testid="individual-student-progress"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-primary">
            <span className="font-mono font-bold text-accent">
              Entries: {entries.length} | Students: {getStudentCount(entries)}
            </span>
          </div>
        </StickyProgressBar>
      )}

      {/* Entry sections */}
      {entries.map((entry) => {
        const isExpanded = expandedIds.has(entry.id);
        const progress = getQuestionProgress(entry);
        const stackedNames = getStackedStudentNames(entry.students);

        return (
          <div
            key={entry.id}
            className="border border-border"
            data-testid={`entry-section-${entry.id}`}
          >
            {/* Header — always visible */}
            <button
              type="button"
              onClick={() => toggleSection(entry.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-bg-card-alt"
              data-testid={`entry-header-${entry.id}`}
            >
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <span
                  className="flex min-w-0 flex-col text-sm font-semibold text-text-primary"
                  data-testid={`entry-student-names-${entry.id}`}
                >
                  {stackedNames.map((name, index) => (
                    <span key={`${entry.id}-${index}`} className="truncate">
                      {name}
                    </span>
                  ))}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium bg-hover-bg text-accent-hover"
                  data-testid={`entry-grade-badge-${entry.id}`}
                >
                  Grade {entry.grade}
                </span>
                <span className="text-xs text-text-muted" data-testid={`entry-progress-${entry.id}`}>
                  {progress}
                </span>
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
                                  yesTestId={`entry-${entry.id}-${question.key}-yes`}
                                  noTestId={`entry-${entry.id}-${question.key}-no`}
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
                                    data-testid={`entry-${entry.id}-${question.key}-remark`}
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
                      onClick={() => handleRemoveEntry(entry.id)}
                      className="text-sm font-medium text-danger underline hover:text-danger/80"
                      data-testid={`remove-entry-${entry.id}`}
                    >
                      Delete Entry
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
