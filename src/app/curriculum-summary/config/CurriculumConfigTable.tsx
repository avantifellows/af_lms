"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";

import type {
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

export default function CurriculumConfigTable({
  rows,
  activeFilters,
}: CurriculumConfigTableProps) {
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<CurriculumConfigRow | null>(null);
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

  return (
    <>
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
                "Config ID",
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
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-mono text-text-secondary">{row.id}</td>
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
    </>
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

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      chapter_id: String(row.chapterId),
      exam_track: row.examTrack,
      config_id: String(row.id),
      coverage_sequence: String(row.coverageSequence),
      prescribed_minutes: String(row.prescribedMinutes),
      is_in_syllabus: String(row.isInSyllabus),
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
    row.coverageSequence,
    row.examTrack,
    row.id,
    row.isInSyllabus,
    row.prescribedMinutes,
  ]);

  const effectiveInSyllabus = row.isInSyllabus || restore;
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

    const response = await fetch(`/api/curriculum/configs/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        is_in_syllabus: effectiveInSyllabus,
        prescribed_minutes: Number(prescribedMinutes),
        coverage_sequence: Number(coverageSequence),
        updated_at: row.updatedAt,
      }),
    });
    const json = await response.json();
    setSaving(false);

    if (response.status === 409) {
      setError("This row changed since you opened it. Reload and reopen the row.");
      return;
    }
    if (!response.ok) {
      setError(json.error ?? "Could not save Curriculum Config row.");
      setFieldErrors(json.fields ?? {});
      return;
    }

    onSaved(json.row);
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
    ["Config ID", String(row.id)],
    ["Chapter ID", String(row.chapterId)],
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
