"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Upload, X } from "lucide-react";

import { Button, Input, Modal } from "@/components/ui";
import {
  buildRejectedRowsCsv,
  formatStudentAdditionDuplicateInFile,
  formatStudentAdditionExistingMatch,
  type StudentAdditionCsvResult,
} from "@/lib/student-addition-fields";

interface BulkStudentUploadModalProps {
  open: boolean;
  schoolUdise: string;
  schoolCode: string;
  onClose: () => void;
  onUploaded: () => void;
}

interface UploadTotals {
  total: number;
  created: number;
  duplicate_in_file: number;
  already_exists: number;
  rejected: number;
}

type UploadResult = StudentAdditionCsvResult & {
  row_number: number;
  status: "created" | "duplicate_in_file" | "already_exists" | "rejected";
  generated_student_id?: string | null;
};

interface UploadResponse {
  error?: string;
  details?: string;
  totals?: UploadTotals;
  results?: UploadResult[];
  ignored_rows?: Array<{ message: string }>;
}

const emptyTotals: UploadTotals = {
  total: 0,
  created: 0,
  duplicate_in_file: 0,
  already_exists: 0,
  rejected: 0,
};

function rowIssues(result: UploadResult, schoolCode: string): string {
  const issues = [
    ...Object.values(result.field_errors ?? {}),
    ...(result.row_errors ?? []),
  ];
  return issues.join("; ") ||
    (result.status === "duplicate_in_file"
      ? formatStudentAdditionDuplicateInFile(result.duplicate_identifiers)
      : "") ||
    (result.existing_match ? formatStudentAdditionExistingMatch(result.existing_match, schoolCode) : "");
}

// fallow-ignore-next-line complexity
export default function BulkStudentUploadModal({
  open,
  schoolUdise,
  schoolCode,
  onClose,
  onUploaded,
}: BulkStudentUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<UploadTotals | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [ignoredRows, setIgnoredRows] = useState<string[]>([]);

  const rejectedCsvHref = useMemo(() => {
    if (!results.some((result) => result.status !== "created")) return null;
    return `data:text/csv;charset=utf-8,${encodeURIComponent(buildRejectedRowsCsv(results, schoolCode))}`;
  }, [results, schoolCode]);

  const done = totals?.created ?? 0;
  const toGo = (totals?.total ?? 0) - done;

  useEffect(() => {
    if (!open) {
      setFile(null);
      setSubmitting(false);
      setError(null);
      setTotals(null);
      setResults([]);
      setIgnoredRows([]);
    }
  }, [open]);

  // fallow-ignore-next-line complexity
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setSubmitting(true);
    setError(null);
    setTotals(null);
    setResults([]);
    setIgnoredRows([]);
    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`/api/school/${encodeURIComponent(schoolUdise)}/students`, {
        method: "POST",
        body,
      });
      const json = await response.json().catch(() => null) as UploadResponse | null;
      if (!json) throw new Error("Upload failed");
      setIgnoredRows((json.ignored_rows ?? []).map((row) => row.message));
      if (!response.ok && !json.results) {
        throw new Error(json.details || json.error || "Upload failed");
      }

      setTotals(json.totals ?? emptyTotals);
      setResults(json.results ?? []);
      if ((json.totals?.created ?? 0) > 0) onUploaded();
      if (!response.ok && json.error) setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // fallow-ignore-next-line code-duplication
    <Modal open={open} onClose={onClose} className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden p-0">
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Bulk Upload Students</h2>
          <p className="mt-1 text-sm text-text-muted">JNV NVS registration</p>
        </div>
        <Button type="button" variant="icon" onClick={onClose} aria-label="Close bulk upload">
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              {error}
            </div>
          )}
          {ignoredRows.length > 0 && (
            <div className="space-y-1 rounded-lg border border-info/30 bg-info-bg p-3 text-sm text-info">
              {ignoredRows.map((message) => <p key={message}>{message}</p>)}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`/api/school/${encodeURIComponent(schoolUdise)}/students`}
              download="nvs-student-addition-template.xlsx"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-bg-card px-4 py-1.5 text-xs font-medium text-text-primary shadow-sm hover:bg-hover-bg"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download template
            </a>
            <p className="text-sm text-text-secondary">
              Each row supplies Grade 11 or 12. PEN or Grade 10 Roll no is required; CBSE roll numbers need exactly 8 digits.
            </p>
          </div>

          <div>
              <label htmlFor="bulk-file" className="block text-sm font-medium text-text-secondary">
                Student upload file
              </label>
              <Input
                id="bulk-file"
                type="file"
                accept=".xlsx,.csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
          </div>

          {totals && (
            <div className="space-y-3 rounded-lg border border-border bg-bg-card-alt p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-base font-semibold text-text-primary">
                  {done} done, {toGo} to go
                </h3>
                {rejectedCsvHref && (
                  <a
                    href={rejectedCsvHref}
                    download="student-addition-rejected-rows.csv"
                    className="text-sm font-medium text-accent hover:text-accent-hover"
                  >
                    Download rejected rows CSV
                  </a>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <span>Uploaded {totals.total}</span>
                <span>Added {totals.created}</span>
                <span>Already present {totals.already_exists}</span>
                <span>Rejected {totals.rejected + totals.duplicate_in_file}</span>
              </div>
              {results.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-md border border-border bg-bg-card">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-bg-card-alt text-text-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Grade</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Student</th>
                        <th className="px-3 py-2 font-medium">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => (
                        <tr key={`${result.row_number}-${result.status}`} className="border-t border-border">
                          <td className="px-3 py-2">{result.row_number}</td>
                          <td className="px-3 py-2">{String(result.original?.Grade ?? "")}</td>
                          <td className="px-3 py-2">{result.status}</td>
                          <td className="px-3 py-2">
                            {String(result.original?.["Student Name"] ?? result.generated_student_id ?? "")}
                          </td>
                          <td className="px-3 py-2">{rowIssues(result, schoolCode)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!file || submitting}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            {submitting ? "Uploading..." : "Upload students"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
