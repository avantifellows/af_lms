"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import type {
  CurriculumConfigChapterOption,
  CurriculumConfigFilters,
  CurriculumConfigRow,
  CurriculumConfigWarning,
} from "@/lib/curriculum-config";
import type { ExamTrack } from "@/types/curriculum";

interface CurriculumConfigTableProps {
  rows: CurriculumConfigRow[];
  activeFilters: CurriculumConfigFilters;
}

interface ImpactState {
  loading: boolean;
  counts: {
    expectedSummaryRows: number;
    activeCurriculumLogs: number;
    activeChapterCompletions: number;
  } | null;
  warnings: CurriculumConfigWarning[];
}

type JsonObject = Record<string, unknown>;

async function readJsonObject(response: Response): Promise<JsonObject> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? (value as JsonObject) : {};
  } catch {
    return {};
  }
}

function jsonError(json: JsonObject, fallback: string): string {
  return typeof json.error === "string" ? json.error : fallback;
}

function jsonFields(json: JsonObject): Record<string, string> {
  return json.fields && typeof json.fields === "object"
    ? (json.fields as Record<string, string>)
    : {};
}

export default function CurriculumConfigTable({
  rows,
  activeFilters,
}: CurriculumConfigTableProps) {
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<CurriculumConfigRow | null>(null);
  const [removingRow, setRemovingRow] = useState<CurriculumConfigRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  function handleSaved(row: CurriculumConfigRow) {
    setEditingRow(null);
    setSuccessMessage(
      rowMatchesFilters(row, activeFilters)
        ? "Curriculum Config row saved."
        : "Curriculum Config row saved but hidden by active filters."
    );
    router.refresh();
  }

  function handleAdded(row: CurriculumConfigRow) {
    setAdding(false);
    setSuccessMessage(
      rowMatchesFilters(row, activeFilters)
        ? "Curriculum Config row added."
        : "Curriculum Config row added but hidden by active filters."
    );
    router.refresh();
  }

  function handleRemoved(row: CurriculumConfigRow) {
    setRemovingRow(null);
    setSuccessMessage(
      rowMatchesFilters(row, activeFilters)
        ? "Curriculum Config row removed."
        : "Curriculum Config row removed but hidden by active filters."
    );
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => {
            setSuccessMessage("");
            setAdding(true);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </button>
      </div>
      {successMessage ? (
        <div
          role="status"
          className="border-b border-border-accent bg-success-bg px-4 py-3 text-sm font-bold text-success"
        >
          {successMessage}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-bg-muted">
            <tr>
              {[
                "Chapter",
                "Grade",
                "Subject",
                "Exam Track",
                "Syllabus",
                "Prescribed",
                "Coverage order",
                "Updated by",
                "Updated at",
                "Actions",
              ].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-bg-card">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-sm text-text-secondary"
                >
                  No Curriculum Config rows match the selected filters.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <div className="font-bold text-text-primary">{row.chapterCode}</div>
                  <div className="text-text-secondary">{row.chapterName}</div>
                  <div className="text-xs text-text-muted">
                    Chapter ID {row.chapterId}
                  </div>
                </td>
                <td className="px-4 py-3 text-text-secondary">{row.grade}</td>
                <td className="px-4 py-3 text-text-secondary">{row.subjectName}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {formatExamTrack(row.examTrack)}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {row.isInSyllabus ? "In syllabus" : "Out of syllabus"}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {row.prescribedMinutes}m ({row.prescribedHoursLabel})
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {row.coverageSequence}
                </td>
                <td className="px-4 py-3 text-text-secondary">{row.updatedByEmail}</td>
                <td className="px-4 py-3 text-text-secondary">{row.updatedAt}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessMessage("");
                      setEditingRow(row);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-bold text-accent hover:text-accent-hover"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </button>
                  {row.isInSyllabus ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSuccessMessage("");
                        setRemovingRow(row);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-danger px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger-bg"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </button>
                  ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editingRow ? (
        <EditPanel
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {removingRow ? (
        <RemovePanel
          row={removingRow}
          onClose={() => setRemovingRow(null)}
          onRemoved={handleRemoved}
        />
      ) : null}
      {adding ? (
        <AddPanel
          activeFilters={activeFilters}
          rows={rows}
          onClose={() => setAdding(false)}
          onAdded={handleAdded}
          onOpenRestore={(row) => {
            setAdding(false);
            setEditingRow(row);
          }}
        />
      ) : null}
    </>
  );
}

function RemovePanel({
  row,
  onClose,
  onRemoved,
}: {
  row: CurriculumConfigRow;
  onClose: () => void;
  onRemoved: (row: CurriculumConfigRow) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [impact, setImpact] = useState<ImpactState>({
    loading: true,
    counts: null,
    warnings: [],
  });

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      chapter_id: String(row.chapterId),
      exam_track: row.examTrack,
      config_id: String(row.id),
      coverage_sequence: String(row.coverageSequence),
      prescribed_minutes: "0",
      is_in_syllabus: "false",
    });
    void fetch(`/api/curriculum/configs/impact?${params.toString()}`)
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled) {
          setImpact({
            loading: false,
            counts: json.counts ?? null,
            warnings: json.warnings ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImpact({ loading: false, counts: null, warnings: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [row.chapterId, row.coverageSequence, row.examTrack, row.id]);

  async function handleRemove() {
    setRemoving(true);
    setError("");
    let completed = false;
    try {
      const response = await fetch(
        `/api/curriculum/configs/${row.id}/remove-from-syllabus`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updated_at: row.updatedAt, lock_token: row.lockToken }),
        }
      );
      const json = await readJsonObject(response);

      if (response.status === 409) {
        setError("This row changed since you opened it. Reload and reopen the row.");
        return;
      }
      if (!response.ok) {
        setError(jsonError(json, "Could not remove Curriculum Config row."));
        return;
      }

      completed = true;
      onRemoved(json.row as CurriculumConfigRow);
    } catch {
      setError("Could not remove Curriculum Config row. Check your connection and try again.");
    } finally {
      if (!completed) {
        setRemoving(false);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30">
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto bg-bg-card shadow-xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
              LMS Chapter Exam Config
            </p>
            <h2 className="text-lg font-bold text-text-primary">
              Remove from syllabus
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close remove panel"
            className="rounded-md border border-border p-2 text-text-secondary hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="space-y-5 px-5 py-5">
            <ReadOnlyGrid row={row} />
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-3 text-sm text-danger">
              <p className="font-bold">{row.chapterCode}</p>
              <p>{row.chapterName}</p>
              <p>{formatExamTrack(row.examTrack)}</p>
            </div>
            <p className="text-sm text-text-secondary">
              This global change removes the row from live Curriculum options and
              Curriculum Summary calculations without deleting historical LMS Curriculum
              Logs or Chapter Completion records.
            </p>
            <ImpactBlock impact={impact} warnings={impact.warnings} />
            {error ? (
              <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm font-bold text-danger">
                {error}
              </div>
            ) : null}
          </div>
          <div className="mt-auto flex justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-bold text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={removing}
              className="rounded-md bg-danger px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
            >
              {removing ? "Removing" : "Remove from syllabus"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function AddPanel({
  activeFilters,
  rows,
  onClose,
  onAdded,
  onOpenRestore,
}: {
  activeFilters: CurriculumConfigFilters;
  rows: CurriculumConfigRow[];
  onClose: () => void;
  onAdded: (row: CurriculumConfigRow) => void;
  onOpenRestore: (row: CurriculumConfigRow) => void;
}) {
  const [examTrack, setExamTrack] = useState<ExamTrack>(activeFilters.examTrack);
  const [grade, setGrade] = useState(activeFilters.grade ? String(activeFilters.grade) : "");
  const [subject, setSubject] = useState(activeFilters.subject ?? "");
  const [search, setSearch] = useState(activeFilters.search);
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [options, setOptions] = useState<CurriculumConfigChapterOption[]>([]);
  const [selected, setSelected] = useState<CurriculumConfigChapterOption | null>(null);
  const [prescribedMinutes, setPrescribedMinutes] = useState(0);
  const [coverageSequence, setCoverageSequence] = useState(1);
  const [isInSyllabus, setIsInSyllabus] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [impact, setImpact] = useState<ImpactState>({
    loading: false,
    counts: null,
    warnings: [],
  });

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      exam_track: examTrack,
      search,
    });
    if (grade) params.set("grade", grade);
    if (subject) params.set("subject", subject);
    void fetch(`/api/curriculum/configs/chapter-options?${params.toString()}`)
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled) {
          setOptions(json.options ?? []);
          setActiveChapterIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [examTrack, grade, subject, search]);

  useEffect(() => {
    if (!selected || selected.configExists) {
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      chapter_id: String(selected.chapterId),
      exam_track: examTrack,
      coverage_sequence: String(coverageSequence),
      prescribed_minutes: String(prescribedMinutes),
      is_in_syllabus: String(isInSyllabus),
    });
    void fetch(`/api/curriculum/configs/impact?${params.toString()}`)
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled) {
          setImpact({
            loading: false,
            counts: json.counts ?? null,
            warnings: json.warnings ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImpact({ loading: false, counts: null, warnings: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [coverageSequence, examTrack, isInSyllabus, prescribedMinutes, selected]);

  function selectOption(option: CurriculumConfigChapterOption) {
    setSelected(option);
    setSearch("");
    setChapterDropdownOpen(false);
    setActiveChapterIndex(0);
    setError("");
    setFieldErrors({});
    setImpact({ loading: !option.configExists, counts: null, warnings: [] });
    setGrade(String(option.grade));
    setSubject(String(option.subjectId));
  }

  async function openRestoreFlow(option: CurriculumConfigChapterOption) {
    setError("");
    const localRow = rows.find((row) => row.id === option.existingConfigId);
    if (localRow) {
      onOpenRestore(localRow);
      return;
    }

    const params = new URLSearchParams({
      exam_track: examTrack,
      grade: String(option.grade),
      subject: String(option.subjectId),
      search: option.chapterCode,
      syllabus_status: "out_of_syllabus",
      limit: "10",
    });
    try {
      const response = await fetch(`/api/curriculum/configs?${params.toString()}`);
      const json = await readJsonObject(response);
      if (!response.ok) {
        setError(jsonError(json, "Could not load the existing out-of-syllabus row."));
        return;
      }
      const candidates = Array.isArray(json.rows)
        ? (json.rows as CurriculumConfigRow[])
        : [];
      const row = candidates.find(
        (candidate) => candidate.id === option.existingConfigId
      );
      if (row) {
        onOpenRestore(row);
      } else {
        setError("Could not load the existing out-of-syllabus row.");
      }
    } catch {
      setError("Could not load the existing out-of-syllabus row. Check your connection and try again.");
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError("Select a chapter before creating a config row.");
      return;
    }
    if (selected.configExists) {
      setError("A config row already exists for this chapter and Exam Track.");
      return;
    }

    setSaving(true);
    setError("");
    setFieldErrors({});
    let completed = false;
    try {
      const response = await fetch("/api/curriculum/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_id: selected.chapterId,
          exam_track: examTrack,
          is_in_syllabus: isInSyllabus,
          prescribed_minutes: Number(prescribedMinutes),
          coverage_sequence: Number(coverageSequence),
        }),
      });
      const json = await readJsonObject(response);

      if (!response.ok) {
        setError(jsonError(json, "Could not add Curriculum Config row."));
        setFieldErrors(jsonFields(json));
        return;
      }

      completed = true;
      onAdded(json.row as CurriculumConfigRow);
    } catch {
      setError("Could not add Curriculum Config row. Check your connection and try again.");
    } finally {
      if (!completed) {
        setSaving(false);
      }
    }
  }

  const selectedDuplicate = selected?.configExists ? selected : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/30">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-bg-card shadow-xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Add missing LMS Chapter Exam Config
            </p>
            <h2 className="text-lg font-bold text-text-primary">
              Add LMS Chapter Exam Config
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close add panel"
            className="rounded-md border border-border p-2 text-text-secondary hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="flex flex-1 flex-col">
          <div className="space-y-5 px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Exam Track
                <select
                  value={examTrack}
                  onChange={(event) => {
                    setExamTrack(event.currentTarget.value as ExamTrack);
                    setSelected(null);
                  }}
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                >
                  <option value="jee_main">JEE Main</option>
                  <option value="jee_advanced">JEE Advanced</option>
                  <option value="neet">NEET</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Grade
                <input
                  value={grade}
                  onChange={(event) => {
                    setGrade(event.currentTarget.value);
                    setSelected(null);
                  }}
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                  placeholder="All"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Subject
                <input
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.currentTarget.value);
                    setSelected(null);
                  }}
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                  placeholder="All"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Chapter search
                <input
                  id="curriculum-config-chapter-search"
                  value={search}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={chapterDropdownOpen}
                  aria-controls="curriculum-config-chapter-options"
                  onChange={(event) => {
                    setSearch(event.currentTarget.value);
                    setSelected(null);
                    setChapterDropdownOpen(true);
                    setActiveChapterIndex(0);
                  }}
                  onFocus={() => setChapterDropdownOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setChapterDropdownOpen(false), 100);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setChapterDropdownOpen(true);
                      setActiveChapterIndex((index) =>
                        options.length === 0
                          ? 0
                          : Math.min(index + 1, options.length - 1)
                      );
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveChapterIndex((index) => Math.max(index - 1, 0));
                    } else if (
                      event.key === "Enter" &&
                      chapterDropdownOpen &&
                      options[activeChapterIndex]
                    ) {
                      event.preventDefault();
                      selectOption(options[activeChapterIndex]);
                    } else if (event.key === "Escape") {
                      setChapterDropdownOpen(false);
                    }
                  }}
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                  placeholder="Code or name"
                />
              </label>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-bold text-text-primary">Chapter</h3>
              <div className="relative">
                {chapterDropdownOpen ? (
                  <div
                    id="curriculum-config-chapter-options"
                    role="listbox"
                    className="absolute z-20 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-bg-card shadow-lg"
                  >
                    {options.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-text-muted">
                        No chapters match the add filters.
                      </div>
                    ) : (
                      options.map((option) => (
                        <button
                          key={option.chapterId}
                          type="button"
                          role="option"
                          aria-selected={selected?.chapterId === option.chapterId}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectOption(option)}
                          className={`w-full border px-3 py-2 text-left text-sm ${
                            options[activeChapterIndex]?.chapterId === option.chapterId
                              ? "border-accent bg-hover-bg"
                              : "border-transparent bg-bg-card"
                          }`}
                        >
                          <span className="block font-bold text-text-primary">
                            {option.chapterCode} - {option.chapterName}
                          </span>
                          <span className="block text-xs text-text-secondary">
                            Grade {option.grade} - {option.subjectName} -{" "}
                            {option.topicCount}{" "}
                            {option.topicCount === 1 ? "topic" : "topics"}
                          </span>
                          {option.topicWarning ? (
                            <span className="mt-1 block text-xs font-bold text-warning-text">
                              {option.topicWarning}
                            </span>
                          ) : null}
                          {option.configExists ? (
                            <span className="mt-1 block text-xs font-bold text-danger">
                              Config already exists for {formatExamTrack(examTrack)}
                            </span>
                          ) : null}
                          <span className="sr-only">Select {option.chapterCode}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              {selected ? (
                <div className="rounded-md border border-border bg-bg-muted px-3 py-2 text-sm">
                  <div className="font-bold text-text-primary">
                    {selected.chapterCode} - {selected.chapterName}
                  </div>
                  <div className="text-xs text-text-secondary">
                    Grade {selected.grade} - {selected.subjectName} -{" "}
                    {selected.topicCount}{" "}
                    {selected.topicCount === 1 ? "topic" : "topics"}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-border bg-bg-muted px-3 py-2 text-sm text-text-secondary">
                  Search and select a chapter to create a config row.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Prescribed minutes
                <input
                  type="number"
                  min="0"
                  value={prescribedMinutes}
                  onChange={(event) =>
                    setPrescribedMinutes(Number(event.currentTarget.value))
                  }
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                />
                {fieldErrors.prescribed_minutes ? (
                  <span className="text-xs text-danger">{fieldErrors.prescribed_minutes}</span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Coverage order
                <input
                  type="number"
                  min="1"
                  value={coverageSequence}
                  onChange={(event) =>
                    setCoverageSequence(Number(event.currentTarget.value))
                  }
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                />
                {fieldErrors.coverage_sequence ? (
                  <span className="text-xs text-danger">{fieldErrors.coverage_sequence}</span>
                ) : null}
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <input
                type="checkbox"
                checked={isInSyllabus}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setIsInSyllabus(checked);
                  if (!checked) setPrescribedMinutes(0);
                }}
                className="h-4 w-4"
              />
              In syllabus
            </label>

            {selectedDuplicate ? (
              <div className="rounded-md border border-warning-border bg-warning-bg px-3 py-3 text-sm text-warning-text">
                <p className="font-bold">
                  A config row already exists for this chapter and Exam Track.
                </p>
                {!selectedDuplicate.existingIsInSyllabus ? (
                  <button
                    type="button"
                    onClick={() => void openRestoreFlow(selectedDuplicate)}
                    className="mt-2 rounded-md border border-warning-border px-3 py-1.5 text-xs font-bold"
                  >
                    Open restore flow
                  </button>
                ) : null}
              </div>
            ) : selected ? (
              <ImpactBlock impact={impact} warnings={impact.warnings} />
            ) : null}

            {error ? (
              <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm font-bold text-danger">
                {error}
              </div>
            ) : null}
          </div>
          <div className="mt-auto flex justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-bold text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !selected || Boolean(selectedDuplicate)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? "Creating" : "Create"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function EditPanel({
  row,
  onClose,
  onSaved,
}: {
  row: CurriculumConfigRow;
  onClose: () => void;
  onSaved: (row: CurriculumConfigRow) => void;
}) {
  const [prescribedMinutes, setPrescribedMinutes] = useState(row.prescribedMinutes);
  const [coverageSequence, setCoverageSequence] = useState(row.coverageSequence);
  const [restore, setRestore] = useState(row.isInSyllabus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [impact, setImpact] = useState<ImpactState>({
    loading: true,
    counts: null,
    warnings: [],
  });
  const effectiveInSyllabus = row.isInSyllabus || restore;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      chapter_id: String(row.chapterId),
      exam_track: row.examTrack,
      config_id: String(row.id),
      coverage_sequence: String(coverageSequence),
      prescribed_minutes: String(prescribedMinutes),
      is_in_syllabus: String(effectiveInSyllabus),
    });
    void fetch(
      `/api/curriculum/configs/impact?${params.toString()}`
    )
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled) {
          setImpact({
            loading: false,
            counts: json.counts ?? null,
            warnings: json.warnings ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImpact({ loading: false, counts: null, warnings: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    row.chapterId,
    row.examTrack,
    row.id,
    coverageSequence,
    effectiveInSyllabus,
    prescribedMinutes,
  ]);

  const localWarnings: CurriculumConfigWarning[] =
    effectiveInSyllabus && Number(prescribedMinutes) === 0
      ? [
          {
            code: "zero_prescribed_minutes",
            message:
              "This in-syllabus row has zero prescribed minutes and will still appear in Curriculum Summary.",
          },
        ]
      : [];
  const warnings = [...impact.warnings, ...localWarnings].filter(
    (warning, index, all) =>
      all.findIndex((candidate) => candidate.code === warning.code) === index
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setFieldErrors({});

    let completed = false;
    try {
      const response = await fetch(`/api/curriculum/configs/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_in_syllabus: effectiveInSyllabus,
          prescribed_minutes: Number(prescribedMinutes),
          coverage_sequence: Number(coverageSequence),
          updated_at: row.updatedAt,
          lock_token: row.lockToken,
        }),
      });
      const json = await readJsonObject(response);

      if (response.status === 409) {
        setError("This row changed since you opened it. Reload and reopen the row.");
        return;
      }
      if (!response.ok) {
        setError(jsonError(json, "Could not save Curriculum Config row."));
        setFieldErrors(jsonFields(json));
        return;
      }

      completed = true;
      onSaved(json.row as CurriculumConfigRow);
    } catch {
      setError("Could not save Curriculum Config row. Check your connection and try again.");
    } finally {
      if (!completed) {
        setSaving(false);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30">
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto bg-bg-card shadow-xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Edit LMS Chapter Exam Config
            </p>
            <h2 className="text-lg font-bold text-text-primary">{row.chapterName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit panel"
            className="rounded-md border border-border p-2 text-text-secondary hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSave} className="flex flex-1 flex-col">
          <div className="space-y-5 px-5 py-5">
            <ReadOnlyGrid row={row} />

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Prescribed minutes
                <input
                  type="number"
                  min="0"
                  value={prescribedMinutes}
                  onChange={(event) =>
                    setPrescribedMinutes(Number(event.currentTarget.value))
                  }
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                />
                {fieldErrors.prescribed_minutes ? (
                  <span className="text-xs text-danger">{fieldErrors.prescribed_minutes}</span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                Coverage order
                <input
                  type="number"
                  min="1"
                  value={coverageSequence}
                  onChange={(event) =>
                    setCoverageSequence(Number(event.currentTarget.value))
                  }
                  className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
                />
                {fieldErrors.coverage_sequence ? (
                  <span className="text-xs text-danger">{fieldErrors.coverage_sequence}</span>
                ) : null}
              </label>
            </div>

            {row.isInSyllabus ? (
              <div className="rounded-md border border-border bg-bg-muted px-3 py-2 text-sm text-text-secondary">
                In-syllabus rows cannot be removed from syllabus in this edit flow.
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm font-bold text-text-primary">
                <input
                  type="checkbox"
                  checked={restore}
                  onChange={(event) => setRestore(event.currentTarget.checked)}
                  className="h-4 w-4"
                />
                Restore to in syllabus
              </label>
            )}

            <ImpactBlock impact={impact} warnings={warnings} />

            {error ? (
              <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm font-bold text-danger">
                {error}
              </div>
            ) : null}
          </div>
          <div className="mt-auto flex justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-bold text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? "Saving" : "Save"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function ReadOnlyGrid({ row }: { row: CurriculumConfigRow }) {
  const items = [
    ["Chapter code", row.chapterCode],
    ["Exam Track", formatExamTrack(row.examTrack)],
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border bg-bg-muted px-3 py-2">
          <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">
            {label}
          </dt>
          <dd className="mt-1 text-sm font-bold text-text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ImpactBlock({
  impact,
  warnings,
}: {
  impact: ImpactState;
  warnings: CurriculumConfigWarning[];
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-bg-muted px-3 py-3">
      <h3 className="text-sm font-bold text-text-primary">Impact</h3>
      {impact.loading ? (
        <p className="text-sm text-text-secondary">Loading impact counts...</p>
      ) : impact.counts ? (
        <div className="grid gap-2 text-sm text-text-secondary sm:grid-cols-3">
          <Metric label="Summary rows" value={impact.counts.expectedSummaryRows} />
          <Metric label="Active logs" value={impact.counts.activeCurriculumLogs} />
          <Metric
            label="Chapter completions"
            value={impact.counts.activeChapterCompletions}
          />
        </div>
      ) : (
        <p className="text-sm text-text-secondary">Impact counts unavailable.</p>
      )}
      {warnings.length ? (
        <div className="space-y-2">
          {warnings.map((warning) => (
            <div
              key={warning.code}
              className="flex gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <span>No warnings for the current values.</span>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-bg-card px-3 py-2">
      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-text-primary">{value}</div>
    </div>
  );
}

function rowMatchesFilters(
  row: CurriculumConfigRow,
  filters: CurriculumConfigFilters
): boolean {
  if (row.examTrack !== filters.examTrack) return false;
  if (filters.grade && row.grade !== filters.grade) return false;
  if (
    filters.subject &&
    String(row.subjectId) !== filters.subject &&
    row.subjectName.toLowerCase() !== filters.subject.toLowerCase()
  ) {
    return false;
  }
  if (filters.syllabusStatus !== "all" && row.syllabusStatus !== filters.syllabusStatus) {
    return false;
  }
  const search = filters.search.toLowerCase();
  if (
    search &&
    !row.chapterCode.toLowerCase().includes(search) &&
    !row.chapterName.toLowerCase().includes(search)
  ) {
    return false;
  }
  return true;
}

function formatExamTrack(track: ExamTrack): string {
  const labels: Record<ExamTrack, string> = {
    jee_main: "JEE Main",
    jee_advanced: "JEE Advanced",
    neet: "NEET",
  };
  return labels[track];
}
