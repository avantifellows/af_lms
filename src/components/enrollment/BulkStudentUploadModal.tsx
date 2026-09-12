"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Download, Upload, X } from "lucide-react";

import { Button, Input, Modal } from "@/components/ui";
import {
  buildRejectedRowsCsv,
  formatStudentAdditionDuplicateInFile,
  formatStudentAdditionExistingMatch,
  type StudentAdditionCsvResult,
} from "@/lib/student-addition-fields";
import {
  ACTIVE_REGISTRATION_MODE,
  PHONE_REGISTRATION_MODE,
  type RegistrationMode,
} from "@/lib/registration-mode";

interface BulkStudentUploadModalProps {
  open: boolean;
  schoolUdise: string;
  schoolCode: string;
  onClose: () => void;
  onUploaded: () => void;
  registrationMode?: RegistrationMode;
}

interface UploadTotals {
  total: number;
  created: number;
  duplicate_in_file: number;
  already_exists: number;
  rejected: number;
}

interface UploadCheckSummary {
  total: number;
  ready: number;
  rejected: number;
}

type UploadResult = StudentAdditionCsvResult & {
  row_number: number;
  status: "created" | "duplicate_in_file" | "already_exists" | "rejected";
  generated_student_id?: string | null;
};

// Preview and final results deliberately have different containers. A ready
// row is not a "created" row until the second request has completed.
type UploadPreviewRow = StudentAdditionCsvResult & {
  row_number: number;
  status: "rejected";
};

interface UploadPreview {
  readyCount: number;
  needsCorrectionCount: number;
  rejectedRows: UploadPreviewRow[];
}

type UploadPhase =
  | "select"
  | "checking"
  | "checked"
  | "check-error"
  | "adding"
  | "complete"
  | "add-error";

function existingMatchIssue(
  result: StudentAdditionCsvResult,
  schoolCode: string,
  registrationMode: RegistrationMode,
) {
  if (!result.existing_match) return "";
  return formatStudentAdditionExistingMatch(
    result.existing_match,
    schoolCode,
    registrationMode,
    result.original?.["Parents Phone Number"],
  );
}

interface TemplateMismatch {
  missing: string[];
  unexpected: string[];
  duplicate: string[];
  legacy_apaar?: boolean;
}

type UploadCheckRow = UploadPreviewRow | (StudentAdditionCsvResult & {
  row_number: number;
  status: "ready";
});

interface UploadResponse {
  error?: string;
  template_mismatch?: TemplateMismatch;
  stage?: "checked";
  summary?: UploadCheckSummary;
  totals?: UploadTotals;
  rows?: UploadCheckRow[];
  results?: unknown;
  ignored_rows?: Array<{ message: string }>;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function parseTotals(value: unknown): UploadTotals | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const total = nonNegativeInteger(candidate.total);
  const created = nonNegativeInteger(candidate.created);
  const duplicateInFile = nonNegativeInteger(candidate.duplicate_in_file);
  const alreadyExists = nonNegativeInteger(candidate.already_exists);
  const rejected = nonNegativeInteger(candidate.rejected);
  if (
    total == null ||
    created == null ||
    duplicateInFile == null ||
    alreadyExists == null ||
    rejected == null
  ) {
    return null;
  }
  return {
    total,
    created,
    duplicate_in_file: duplicateInFile,
    already_exists: alreadyExists,
    rejected,
  };
}

function isNumberedRow(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.row_number === "number" &&
    Number.isInteger(row.row_number) && row.row_number > 0;
}

function responseRows(value: unknown): UploadResult[] | null {
  if (!Array.isArray(value)) return null;
  const results = value.filter((result): result is UploadResult => {
    if (!isNumberedRow(result)) return false;
    return ["created", "duplicate_in_file", "already_exists", "rejected"].includes(
      result.status as string,
    );
  });
  if (results.length !== value.length) return null;
  return results;
}

function hasCompleteFinalResponse(
  totals: UploadTotals | null,
  results: UploadResult[] | null,
): results is UploadResult[] {
  if (!totals || !results || results.length !== totals.total) return false;
  const counts = results.reduce(
    (summary, result) => ({ ...summary, [result.status]: summary[result.status] + 1 }),
    { created: 0, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
  );
  return counts.created === totals.created &&
    counts.duplicate_in_file === totals.duplicate_in_file &&
    counts.already_exists === totals.already_exists &&
    counts.rejected === totals.rejected;
}

function parseCheckedRows(value: unknown): UploadCheckRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter((result): result is UploadCheckRow => {
    return isNumberedRow(result) &&
      (result.status === "ready" || result.status === "rejected");
  });
  if (rows.length !== value.length) return null;
  return rows.map((row) => ({
    ...row,
    unsupported_choice_fields: Array.isArray(row.unsupported_choice_fields)
      ? row.unsupported_choice_fields.filter((field) =>
        typeof field === "string" && typeof row.field_errors?.[field] === "string",
      )
      : [],
  }));
}

function previewFromResponse(json: UploadResponse): UploadPreview | null {
  if (json.stage !== "checked" || !json.summary) return null;
  const total = nonNegativeInteger(json.summary.total);
  const readyCount = nonNegativeInteger(json.summary.ready);
  const needsCorrectionCount = nonNegativeInteger(json.summary.rejected);
  const checkedRows = parseCheckedRows(json.rows);
  if (
    readyCount == null ||
    needsCorrectionCount == null ||
    !checkedRows ||
    total !== readyCount + needsCorrectionCount ||
    checkedRows.length !== total
  ) return null;
  const rejectedRows = checkedRows.filter((row): row is UploadPreviewRow => row.status === "rejected");
  if (rejectedRows.length !== needsCorrectionCount) return null;
  return {
    readyCount,
    needsCorrectionCount,
    rejectedRows,
  };
}

function rowIssues(
  result: StudentAdditionCsvResult,
  schoolCode: string,
  registrationMode: RegistrationMode,
): string[] {
  const existingMatch = existingMatchIssue(result, schoolCode, registrationMode);
  if (result.status === "rejected" && existingMatch) return [existingMatch];

  const issues = [
    ...Object.values(result.field_errors ?? {}),
    ...(result.row_errors ?? []),
  ];
  if (issues.length > 0) return issues;
  const fallback = result.status === "duplicate_in_file"
    ? formatStudentAdditionDuplicateInFile(result.duplicate_identifiers)
    : existingMatch;
  return fallback ? [fallback] : [];
}

function statusLabel(status: UploadResult["status"]): string {
  switch (status) {
    case "created":
      return "Added";
    case "already_exists":
      return "Already present";
    case "duplicate_in_file":
      return "Rejected";
    default:
      return "Rejected";
  }
}

function ignoredMessages(value: UploadResponse["ignored_rows"]): string[] {
  return (value ?? [])
    .map((row) => row.message)
    .filter((message): message is string => typeof message === "string" && message.length > 0);
}

function templateMismatch(value: unknown): TemplateMismatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const groups = [candidate.missing, candidate.unexpected, candidate.duplicate];
  if (!groups.every((group) => Array.isArray(group))) return null;
  return {
    missing: candidate.missing as string[],
    unexpected: candidate.unexpected as string[],
    duplicate: candidate.duplicate as string[],
    ...(candidate.legacy_apaar === true ? { legacy_apaar: true } : {}),
  };
}

function unknownResponseMessage(action: "validate" | "upload"): string {
  return action === "validate"
    ? "We could not check this file. Please try again or choose a different file."
    : "The final result was not returned. Some rows may still be processing. Do not try Check & add students again; wait a minute and check the student list before starting a new upload.";
}

function requestErrorMessage(action: "validate" | "upload"): string {
  return action === "validate"
    ? "We could not check this file. Please try again or choose a different file."
    : "The final result could not be confirmed. Some rows may still be processing. Do not try Check & add students again; check the student list before starting a new upload.";
}

function finalUnknownOutcomeMessage(serverError: unknown): string {
  const detail = typeof serverError === "string" ? serverError.trim() : "";
  return detail
    ? `${detail} ${unknownResponseMessage("upload")}`
    : unknownResponseMessage("upload");
}

class UnknownFinalOutcomeError extends Error {
  readonly unknownFinalOutcome = true;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// fallow-ignore-next-line complexity
export default function BulkStudentUploadModal({
  open,
  schoolUdise,
  schoolCode,
  onClose,
  onUploaded,
  registrationMode = ACTIVE_REGISTRATION_MODE,
}: BulkStudentUploadModalProps) {
  const phoneMode = registrationMode === PHONE_REGISTRATION_MODE;
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("select");
  const [error, setError] = useState<string | null>(null);
  const [headerDetails, setHeaderDetails] = useState<TemplateMismatch | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [finalTotals, setFinalTotals] = useState<UploadTotals | null>(null);
  const [finalResults, setFinalResults] = useState<UploadResult[]>([]);
  const [ignoredRows, setIgnoredRows] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  // This is intentionally a ref as well as a disabled button: a second
  // submit event can arrive before React renders the checking state.
  const checkAttemptedRef = useRef(false);
  // This is intentionally a ref: a second click must be rejected before the
  // state update for `adding` is observed by React.
  const finalAttemptedRef = useRef(false);
  const refreshSentRef = useRef(false);

  const rejectedCsvHref = useMemo(() => {
    const rejectedRows = phase === "checked"
      ? (preview?.rejectedRows ?? [])
      : phase === "complete"
        ? finalResults.filter((result) => result.status !== "created")
        : [];
    if (rejectedRows.length === 0) return null;
    return `data:text/csv;charset=utf-8,${encodeURIComponent(buildRejectedRowsCsv(rejectedRows, schoolCode, registrationMode))}`;
  }, [phase, preview?.rejectedRows, finalResults, schoolCode, registrationMode]);

  const templateHref = `/api/school/${encodeURIComponent(schoolUdise)}/students`;
  const templateFilename = phoneMode
    ? "NVS_Lakshya_Data_Template_updated_19th_August_2026.xlsx"
    : "nvs-student-addition-template.xlsx";
  const busy = phase === "checking" || phase === "adding";

  function invalidateRequest() {
    requestIdRef.current += 1;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }

  function resetState(clearInput = false) {
    invalidateRequest();
    checkAttemptedRef.current = false;
    finalAttemptedRef.current = false;
    refreshSentRef.current = false;
    if (clearInput && fileInputRef.current) fileInputRef.current.value = "";
    setFile(null);
    setPhase("select");
    setError(null);
    setHeaderDetails(null);
    setPreview(null);
    setFinalTotals(null);
    setFinalResults([]);
    setIgnoredRows([]);
  }

  useEffect(() => {
    resetState(true);
    // A school or registration-mode change must never carry a checked file or
    // result into a different upload context. File changes use
    // handleFileChange so the newly selected File object is retained.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schoolUdise, registrationMode]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (phase === "adding") return;
    const nextFile = event.target.files?.[0] ?? null;
    resetState();
    setFile(nextFile);
  }

  function handleClose() {
    if (phase === "adding") return;
    resetState(true);
    onClose();
  }

  function handleUploadAnother() {
    resetState(true);
  }

  function handleDone() {
    handleClose();
  }

  async function requestFile(action: "validate" | "upload", requestFileValue: File) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;

    const body = new FormData();
    body.append("file", requestFileValue);
    body.append("action", action);

    let response: Response;
    try {
      response = await fetch(templateHref, {
        method: "POST",
        body,
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted || requestIdRef.current !== requestId) return null;
      throw new UnknownFinalOutcomeError(requestErrorMessage(action));
    }

    const json = await response.json().catch(() => null) as UploadResponse | null;
    if (requestIdRef.current !== requestId) return null;
    if (!json) throw new UnknownFinalOutcomeError(unknownResponseMessage(action));
    return { response, json, requestId };
  }

  // fallow-ignore-next-line complexity
  async function handleCheck() {
    if (
      !file ||
      phase === "checking" ||
      phase === "adding" ||
      phase === "complete" ||
      checkAttemptedRef.current
    ) return;
    checkAttemptedRef.current = true;
    const requestFileValue = file;
    invalidateRequest();
    const expectedRequestId = requestIdRef.current + 1;
    setPhase("checking");
    setError(null);
    setHeaderDetails(null);
    setPreview(null);
    setFinalTotals(null);
    setFinalResults([]);
    setIgnoredRows([]);

    try {
      const result = await requestFile("validate", requestFileValue);
      if (!result) return;
      const { response, json, requestId } = result;
      if (requestIdRef.current !== requestId) return;

      const details = templateMismatch(json.template_mismatch);
      setHeaderDetails(details);
      setIgnoredRows(ignoredMessages(json.ignored_rows));
      const nextPreview = previewFromResponse(json);
      if (!response.ok) throw new Error(json.error || unknownResponseMessage("validate"));
      if (!nextPreview) throw new Error(unknownResponseMessage("validate"));
      setPreview(nextPreview);
      setPhase("checked");
    } catch (err) {
      if (requestIdRef.current !== expectedRequestId) return;
      setPhase("check-error");
      setError(err instanceof Error ? err.message : requestErrorMessage("validate"));
    } finally {
      if (requestIdRef.current === expectedRequestId) {
        checkAttemptedRef.current = false;
        activeControllerRef.current = null;
      }
    }
  }

  // fallow-ignore-next-line complexity
  async function handleAdd() {
    if (
      !file ||
      !preview ||
      preview.readyCount <= 0 ||
      phase !== "checked" ||
      finalAttemptedRef.current
    ) return;

    finalAttemptedRef.current = true;
    const requestFileValue = file;
    invalidateRequest();
    const expectedRequestId = requestIdRef.current + 1;
    setPhase("adding");
    setError(null);
    setHeaderDetails(null);
    setFinalTotals(null);
    setFinalResults([]);

    try {
      const result = await requestFile("upload", requestFileValue);
      if (!result) return;
      const { json, requestId } = result;
      if (requestIdRef.current !== requestId) return;

      const details = templateMismatch(json.template_mismatch);
      setHeaderDetails(details);
      setIgnoredRows(ignoredMessages(json.ignored_rows));
      const totals = parseTotals(json.totals);
      const results = responseRows(json.results);
      if (!totals || !hasCompleteFinalResponse(totals, results)) {
        throw new UnknownFinalOutcomeError(finalUnknownOutcomeMessage(json.error));
      }

      setFinalTotals(totals);
      setFinalResults(results);
      setPhase("complete");
      if (totals.created > 0 && !refreshSentRef.current) {
        refreshSentRef.current = true;
        onUploaded();
      }
    } catch (err) {
      if (requestIdRef.current !== expectedRequestId) return;
      if (err instanceof UnknownFinalOutcomeError && !refreshSentRef.current) {
        // The upload may have reached DB Service before the response was
        // lost. Refresh once so the roster can surface any committed rows,
        // while keeping this attempt permanently non-retryable.
        refreshSentRef.current = true;
        onUploaded();
      }
      setPhase("add-error");
      setError(err instanceof Error ? err.message : requestErrorMessage("upload"));
    } finally {
      if (requestIdRef.current === expectedRequestId) activeControllerRef.current = null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "select" || phase === "check-error") {
      void handleCheck();
    } else if (phase === "checked") {
      void handleAdd();
    }
  }

  return (
    // fallow-ignore-next-line code-duplication
    <Modal
      open={open}
      onClose={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-upload-title"
      aria-describedby="bulk-upload-description"
      className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden p-0"
    >
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <h2 id="bulk-upload-title" className="text-xl font-semibold text-text-primary">
            Bulk Upload Students
          </h2>
          <p className="mt-1 text-sm text-text-muted">JNV NVS registration</p>
        </div>
        <Button
          type="button"
          variant="icon"
          onClick={handleClose}
          disabled={phase === "adding"}
          aria-label="Close bulk upload"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div
          className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
          aria-busy={busy}
        >
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger"
            >
              <p>{headerDetails
                ? headerDetails.legacy_apaar
                  ? "This workbook uses the old APAAR template."
                  : "The uploaded headers do not match the current template."
                : error}</p>
              {headerDetails && (
                <div className="mt-2 space-y-1">
                  {headerDetails.missing.length > 0 && (
                    <p>Missing columns: {headerDetails.missing.join(", ")}</p>
                  )}
                  {headerDetails.unexpected.length > 0 && (
                    <p>Unrecognized columns: {headerDetails.unexpected.join(", ")}</p>
                  )}
                  {headerDetails.duplicate.length > 0 && (
                    <p>Duplicate columns: {headerDetails.duplicate.join(", ")}</p>
                  )}
                  <a
                    href={templateHref}
                    download={templateFilename}
                    className="font-medium underline underline-offset-2"
                  >
                    Download the current template
                  </a>
                </div>
              )}
            </div>
          )}

          {ignoredRows.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="space-y-1 rounded-lg border border-info/30 bg-info-bg p-3 text-sm text-info"
            >
              {ignoredRows.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={templateHref}
              download={templateFilename}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-bg-card px-4 py-1.5 text-xs font-medium text-text-primary shadow-sm hover:bg-hover-bg"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download template
            </a>
            <p id="bulk-upload-description" className="text-sm text-text-secondary">
              {phoneMode
                ? "Phone Registration Mode: upload the 11 approved fields. Parent phone is the Student ID and must be 10 digits starting with 6-9."
                : "Each row supplies Grade 11 or 12. PEN or Grade 10 Roll no is required; CBSE roll numbers need exactly 8 digits."}
            </p>
          </div>

          <div>
            <h3 className="mb-1 text-base font-semibold text-text-primary">
              Step 1: Check spreadsheet
            </h3>
            <p className="mb-3 text-sm text-text-secondary">
              Check the file’s columns, required values{phoneMode ? ", and repeated phone numbers" : ""}. No students will be added.
            </p>
            <label htmlFor="bulk-file" className="block text-sm font-medium text-text-secondary">
              Student upload file
            </label>
            <Input
              ref={fileInputRef}
              id="bulk-file"
              type="file"
              accept=".xlsx,.csv"
              disabled={busy || phase === "complete"}
              aria-describedby="bulk-file-help"
              onChange={handleFileChange}
            />
            <p id="bulk-file-help" className="mt-1 text-xs text-text-muted">
              Choosing a file does not add students.
            </p>
            {file && (
              <p className="mt-1 break-words text-xs text-text-muted">
                Selected file: {file.name}
              </p>
            )}
          </div>

          {phase === "checking" && (
            <p role="status" aria-live="polite" className="text-sm text-text-secondary">
              Checking spreadsheet… Nothing has been added yet.
            </p>
          )}

          {phase === "checked" && preview && (
            <section
              aria-labelledby="bulk-upload-check-results"
              aria-live="polite"
              className="space-y-3 rounded-lg border border-border bg-bg-card-alt p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h3 id="bulk-upload-check-results" className="text-base font-semibold text-text-primary">
                    Spreadsheet check complete
                  </h3>
                  <p className="mt-1 text-sm font-medium text-text-primary">
                    Nothing has been added yet.
                  </p>
                </div>
                {rejectedCsvHref && (
                  <a
                    href={rejectedCsvHref}
                    download="student-addition-rejected-rows.csv"
                    className="text-sm font-medium text-accent hover:text-accent-hover"
                  >
                    Download rows needing correction
                  </a>
                )}
              </div>
              <p className="text-base font-semibold text-text-primary">
                {countLabel(preview.readyCount + preview.needsCorrectionCount, "row")} checked
              </p>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <span>{countLabel(preview.readyCount, "row")} passed spreadsheet checks</span>
                <span>{countLabel(preview.needsCorrectionCount, "row")} need{preview.needsCorrectionCount === 1 ? "s" : ""} correction{preview.needsCorrectionCount > 0 ? " — these will not be added" : ""}</span>
              </div>
              {preview.rejectedRows.some((row) => (row.unsupported_choice_fields?.length ?? 0) > 0) && (
                <p className="text-sm text-text-secondary">
                  Use the choices from a freshly downloaded LMS template. Editing the spreadsheet’s dropdown list does not change the values LMS accepts.
                </p>
              )}
              {preview.rejectedRows.length > 0 && (
                <ResultTable
                  results={preview.rejectedRows}
                  preview
                  schoolCode={schoolCode}
                  registrationMode={registrationMode}
                />
              )}
            </section>
          )}

          {phase === "checked" && preview && (
            <section aria-labelledby="bulk-upload-next-step" className="space-y-2">
              {preview.readyCount > 0 ? (
                <>
                  <h3 id="bulk-upload-next-step" className="text-base font-semibold text-text-primary">
                    Step 2: Check existing records and add students
                  </h3>
                  <p className="text-sm text-text-secondary">
                    Only the {countLabel(preview.readyCount, "row")} that passed will continue. We’ll check for existing students and other registration issues, then add eligible new students. Already registered students will be skipped.
                  </p>
                </>
              ) : (
                <p id="bulk-upload-next-step" className="text-sm text-text-secondary">
                  No rows can continue yet. Correct the errors and choose the updated file to check it again.
                </p>
              )}
            </section>
          )}

          {phase === "adding" && (
            <p role="status" aria-live="polite" className="text-sm text-text-secondary">
              Checking existing records and adding eligible students… Please wait for the final result.
            </p>
          )}

          {phase === "complete" && finalTotals && (
            <section
              aria-labelledby="bulk-upload-complete"
              aria-live="polite"
              className="space-y-3 rounded-lg border border-border bg-bg-card-alt p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h3 id="bulk-upload-complete" className="text-base font-semibold text-text-primary">
                    Upload complete
                  </h3>
                  <p className="mt-1 text-sm text-text-secondary">
                    The final checks have finished.
                  </p>
                </div>
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
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <span>Added {finalTotals.created}</span>
                <span>Already present {finalTotals.already_exists}</span>
                <span>Rejected {finalTotals.rejected + finalTotals.duplicate_in_file}</span>
              </div>
              {finalResults.length > 0 && (
                <ResultTable
                  results={finalResults}
                  schoolCode={schoolCode}
                  registrationMode={registrationMode}
                />
              )}
            </section>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          {(phase === "complete" || phase === "add-error") ? (
            <>
              <Button type="button" variant="secondary" onClick={handleDone}>
                Done
              </Button>
              <Button type="button" onClick={handleUploadAnother}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Upload another file
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={handleClose} disabled={phase === "adding"}>
                Cancel
              </Button>
              {(phase === "select" || phase === "check-error") && (
                <Button type="submit" disabled={!file || busy}>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Check spreadsheet
                </Button>
              )}
              {phase === "checked" && preview && preview.readyCount > 0 && (
                <Button type="submit" disabled={busy || finalAttemptedRef.current}>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Check &amp; add students
                </Button>
              )}
              {phase === "checking" && (
                <Button type="submit" disabled>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Checking…
                </Button>
              )}
              {phase === "adding" && (
                <Button type="submit" disabled>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Checking &amp; adding…
                </Button>
              )}
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

function ResultTable({
  results,
  preview,
  schoolCode,
  registrationMode,
}: {
  results: Array<UploadResult | UploadPreviewRow>;
  preview?: boolean;
  schoolCode: string;
  registrationMode: RegistrationMode;
}) {
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border bg-bg-card">
      <table className="w-[calc(100vw+13rem)] table-fixed text-left text-sm sm:w-full sm:min-w-[40rem]">
        <caption className="sr-only">
          {preview ? "Rows needing correction" : "Bulk upload final results"}
        </caption>
        <colgroup>
          <col className="w-12" />
          <col className="w-16" />
          <col className="w-28" />
          <col className="w-28" />
          <col />
        </colgroup>
        <thead className="bg-bg-card-alt text-text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Row</th>
            <th scope="col" className="px-3 py-2 font-medium">Grade</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Student</th>
            <th scope="col" className="px-3 py-2 font-medium">Issue</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <tr key={`${result.row_number}-${result.status}-${index}`} className="border-t border-border align-top [overflow-wrap:anywhere]">
              <td className="px-3 py-2">{result.row_number}</td>
              <td className="px-3 py-2">{String(result.original?.Grade ?? "")}</td>
              <td className="px-3 py-2">{preview ? "Needs correction" : statusLabel(result.status as UploadResult["status"])}</td>
              <td className="px-3 py-2">
                {String(result.original?.["Student Name"] ?? (result as UploadResult).generated_student_id ?? "")}
              </td>
              <td className="px-3 py-2">
                <ul className="divide-y divide-border">
                  {rowIssues(result, schoolCode, registrationMode).map((message, issueIndex) => {
                    const choice = /^([^:\n]+): ([\s\S]* isn’t supported\.) (Allowed values: [\s\S]*)$/.exec(message);
                    return (
                      <li key={issueIndex} className="whitespace-pre-wrap py-3 first:pt-0 last:pb-0">
                        {choice ? (
                          <>
                            <p className="font-semibold">{choice[1]}</p>
                            <p className="mt-1 leading-relaxed">{choice[2]}</p>
                            <p className="mt-1 text-xs leading-relaxed text-text-muted">{choice[3]}</p>
                          </>
                        ) : <p className="leading-relaxed">{message}</p>}
                      </li>
                    );
                  })}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
