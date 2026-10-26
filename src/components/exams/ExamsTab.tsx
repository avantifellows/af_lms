"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, FormSection } from "@/components/ui";
import {
  examSessionsFor,
  requiredExamNamesForBoardStream,
  type ExamOption,
  type StudentExamRecord,
} from "@/lib/competitive-exams";

interface ExamsTabProps {
  studentId: number;
  /** Drives which exams open by default: PCM → JEE Mains, PCB → NEET, PCMB → both. */
  boardStream: string | null | undefined;
  /** Called after a save lands, so the roster behind the modal can refresh. */
  onSaved: () => void;
}

interface ExamRow {
  /** `student_exam_record.id`, or null for a row that has never been saved. */
  recordId: number | null;
  examId: number;
  examName: string;
  applicationNumber: string;
  applicationPassword: string;
  sessionsApplied: number[];
}

const inputClassName =
  "mt-1 block w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors";
const labelClassName = "block text-sm font-medium text-text-secondary";
const errorClassName = "mt-1 text-xs text-danger";

function toRow(record: StudentExamRecord): ExamRow {
  return {
    recordId: record.id,
    examId: record.exam_id,
    examName: record.exam_name,
    applicationNumber: record.application_number ?? "",
    applicationPassword: record.application_password ?? "",
    sessionsApplied: record.sessions_applied ?? [],
  };
}

/**
 * Rows to open the tab with: everything already stored, then an empty row for
 * each exam the Board Stream calls for that has nothing stored yet.
 */
function initialRows(
  records: StudentExamRecord[],
  exams: ExamOption[],
  boardStream: string | null | undefined,
): ExamRow[] {
  const rows = records.map(toRow);
  const seen = new Set(rows.map((row) => row.examId));
  for (const name of requiredExamNamesForBoardStream(boardStream)) {
    const exam = exams.find((option) => option.name === name);
    if (!exam || seen.has(exam.id)) continue;
    seen.add(exam.id);
    rows.push({
      recordId: null,
      examId: exam.id,
      examName: exam.name,
      applicationNumber: "",
      applicationPassword: "",
      sessionsApplied: [],
    });
  }
  return rows;
}

function isBlank(row: ExamRow): boolean {
  return (
    !row.applicationNumber.trim() &&
    !row.applicationPassword.trim() &&
    row.sessionsApplied.length === 0
  );
}

// fallow-ignore-next-line complexity
export function ExamsTab({ studentId, boardStream, onSaved }: ExamsTabProps) {
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [removedRecordIds, setRemovedRecordIds] = useState<number[]>([]);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [pickerValue, setPickerValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/students/${studentId}/exam-records`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setLoadError(`Failed to load exams (${res.status})`);
        return;
      }
      const data: { exams: ExamOption[]; records: StudentExamRecord[] } = await res.json();
      setExams(data.exams ?? []);
      setRows(initialRows(data.records ?? [], data.exams ?? [], boardStream));
      setRemovedRecordIds([]);
      setRevealed({});
      setRowErrors({});
    } catch (err) {
      console.error("ExamsTab fetch failed:", err);
      setLoadError("Network error while loading exams.");
    } finally {
      setLoading(false);
    }
  }, [studentId, boardStream]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableExams = useMemo(() => {
    const listed = new Set(rows.map((row) => row.examId));
    return exams.filter((exam) => !listed.has(exam.id));
  }, [exams, rows]);

  function updateRow(examId: number, change: Partial<ExamRow>) {
    setSaved(false);
    setRows((current) =>
      current.map((row) => (row.examId === examId ? { ...row, ...change } : row)),
    );
  }

  function addExam(examId: number) {
    const exam = exams.find((option) => option.id === examId);
    if (!exam) return;
    setSaved(false);
    setRows((current) => [
      ...current,
      {
        recordId: null,
        examId: exam.id,
        examName: exam.name,
        applicationNumber: "",
        applicationPassword: "",
        sessionsApplied: [],
      },
    ]);
  }

  function removeExam(examId: number) {
    setSaved(false);
    setRows((current) => {
      const row = current.find((candidate) => candidate.examId === examId);
      // A stored registration is only deleted when the save goes through, so
      // the id is remembered rather than the row being dropped silently.
      if (row?.recordId) {
        setRemovedRecordIds((ids) =>
          ids.includes(row.recordId!) ? ids : [...ids, row.recordId!],
        );
      }
      return current.filter((candidate) => candidate.examId !== examId);
    });
    setRowErrors((current) => {
      const next = { ...current };
      delete next[examId];
      return next;
    });
  }

  function toggleSession(row: ExamRow, session: number) {
    const sessions = row.sessionsApplied.includes(session)
      ? row.sessionsApplied.filter((value) => value !== session)
      : [...row.sessionsApplied, session].sort((a, b) => a - b);
    updateRow(row.examId, { sessionsApplied: sessions });
  }

  async function handleSave() {
    setError("");
    setWarnings([]);
    setSaved(false);

    // An untouched suggestion is not an answer, so it is left unsaved. A row
    // with anything in it needs the application number the exam portal issued.
    const filled = rows.filter((row) => row.recordId !== null || !isBlank(row));
    const missing = filled.filter((row) => !row.applicationNumber.trim());
    if (missing.length > 0) {
      setRowErrors(
        Object.fromEntries(
          missing.map((row) => [
            row.examId,
            "Application number is required — fill it in or remove this exam",
          ]),
        ),
      );
      return;
    }
    setRowErrors({});

    if (filled.length === 0 && removedRecordIds.length === 0) {
      setError("No exam changes to save");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/exam-records`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exams: filled.map((row) => ({
            exam_id: row.examId,
            application_number: row.applicationNumber.trim(),
            application_password: row.applicationPassword.trim(),
            sessions_applied: row.sessionsApplied,
          })),
          removed_record_ids: removedRecordIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to save exams");
        return;
      }
      setRows(initialRows(data.records ?? [], exams, boardStream));
      setRemovedRecordIds([]);
      setWarnings(data.warnings ?? []);
      setSaved(true);
      onSaved();
    } catch (err) {
      console.error("ExamsTab save failed:", err);
      setError("Network error while saving exams.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="px-6 py-5 text-sm text-text-muted">Loading exams…</p>;
  }
  if (loadError) {
    return (
      <div className="px-6 py-5">
        <p className="text-sm text-danger">{loadError}</p>
        <Button variant="ghost" size="sm" onClick={() => void load()} className="mt-2">
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
            {error}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-sm text-warning">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        {saved && warnings.length === 0 && (
          <p className="text-sm text-success">Exam details saved.</p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className={labelClassName} htmlFor="add-exam">
              Add exam
            </label>
            <select
              id="add-exam"
              value={pickerValue}
              disabled={availableExams.length === 0}
              onChange={(event) => {
                const examId = Number(event.target.value);
                if (examId) addExam(examId);
                setPickerValue("");
              }}
              className={inputClassName}
            >
              <option value="">
                {availableExams.length === 0 ? "All exams added" : "Select an exam"}
              </option>
              {availableExams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-text-muted">
            No exams added yet. Pick one above to record an application.
          </p>
        ) : (
          rows.map((row) => {
            const sessions = examSessionsFor(row.examName);
            return (
              <FormSection key={row.examId}>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">{row.examName}</h3>
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => removeExam(row.examId)}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className={labelClassName} htmlFor={`application_number_${row.examId}`}>
                      Application number
                    </label>
                    <input
                      id={`application_number_${row.examId}`}
                      type="text"
                      value={row.applicationNumber}
                      onChange={(event) =>
                        updateRow(row.examId, { applicationNumber: event.target.value })
                      }
                      className={inputClassName}
                    />
                    {rowErrors[row.examId] && (
                      <p className={errorClassName}>{rowErrors[row.examId]}</p>
                    )}
                  </div>
                  <div>
                    <label
                      className={labelClassName}
                      htmlFor={`application_password_${row.examId}`}
                    >
                      Application password
                    </label>
                    <div className="flex items-end gap-2">
                      <input
                        id={`application_password_${row.examId}`}
                        type={revealed[row.examId] ? "text" : "password"}
                        autoComplete="off"
                        value={row.applicationPassword}
                        onChange={(event) =>
                          updateRow(row.examId, { applicationPassword: event.target.value })
                        }
                        className={inputClassName}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setRevealed((current) => ({
                            ...current,
                            [row.examId]: !current[row.examId],
                          }))
                        }
                        aria-label={
                          revealed[row.examId]
                            ? `Hide ${row.examName} password`
                            : `Show ${row.examName} password`
                        }
                      >
                        {revealed[row.examId] ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </div>
                  {sessions.length > 0 && (
                    <fieldset className="md:col-span-2">
                      <legend className={labelClassName}>Sessions applied</legend>
                      <div className="mt-1 flex flex-wrap gap-4">
                        {sessions.map((session) => (
                          <label
                            key={session}
                            className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary"
                          >
                            <input
                              type="checkbox"
                              checked={row.sessionsApplied.includes(session)}
                              onChange={() => toggleSession(row, session)}
                              className="h-4 w-4 rounded border-2 border-border text-accent focus:ring-accent/20"
                            />
                            Session {session}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              </FormSection>
            );
          })
        )}
      </div>

      <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving…" : "Save Exams"}
        </Button>
      </div>
    </div>
  );
}
