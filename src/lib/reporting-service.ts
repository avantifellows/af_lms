// Server-side client for the Reporting engine's combined-report job API.
// Mirrors the db-service-documents.ts pattern: a shared service key in an env
// var, never exposed to the browser. The user is authorized for the school by
// the calling API route (authorizeSchoolAccess); reporting trusts this key.
// Wire contract: reporting/docs/combined-reports-contract.md.

export interface ReportStudentRef {
  user_id?: string | null;
  student_id?: string | null;
  apaar_id?: string | null;
}

export interface SchoolRef {
  udise?: string | null;
  code?: string | null;
  name?: string | null;
}

export interface CombinedReportJob {
  job_id: string;
  session_id: string;
  school_code: string;
  test_name: string | null;
  status: "queued" | "started" | "processing" | "done" | "errored";
  student_count: number | null;
  matched_count: number | null;
  missing_count: number | null;
  error: string | null;
  download_url: string | null;
  created_at: string;
  updated_at: string;
  retry_count: number;
}

export class ReportingServiceError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ReportingServiceError";
    this.status = status;
    this.body = body;
  }
}

function reportingUrl(): string {
  const url = process.env.REPORTING_SERVICE_URL;
  if (!url) throw new Error("REPORTING_SERVICE_URL is not set");
  return url.replace(/\/$/, "");
}

function serviceKey(): string {
  const key = process.env.REPORTING_SERVICE_API_KEY;
  if (!key) throw new Error("REPORTING_SERVICE_API_KEY is not set");
  return key;
}

function headers(): HeadersInit {
  return {
    "X-Api-Key": serviceKey(),
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

async function parseOrThrow(res: Response, action: string) {
  if (!res.ok) {
    const body = await res.text();
    throw new ReportingServiceError(
      `Reporting service ${action} failed (${res.status})`,
      res.status,
      body,
    );
  }
  return res.json();
}

export async function submitCombinedReport(input: {
  sessionId: string;
  school: SchoolRef;
  students: ReportStudentRef[];
  testName?: string | null;
  requestedBy?: string | null;
}): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${reportingUrl()}/reports/combined`, {
    method: "POST",
    headers: headers(),
    cache: "no-store",
    body: JSON.stringify({
      session_id: input.sessionId,
      school: input.school,
      students: input.students,
      test_name: input.testName ?? null,
      requested_by: input.requestedBy ?? null,
    }),
  });
  return parseOrThrow(res, "submit");
}

export async function getCombinedReportJob(
  jobId: string,
): Promise<CombinedReportJob> {
  const res = await fetch(
    `${reportingUrl()}/reports/combined/${encodeURIComponent(jobId)}`,
    { method: "GET", headers: headers(), cache: "no-store" },
  );
  return parseOrThrow(res, "status");
}

export async function listCombinedReportJobs(
  sessionId: string,
  schoolCode: string,
): Promise<CombinedReportJob[]> {
  const url =
    `${reportingUrl()}/reports/combined` +
    `?session_id=${encodeURIComponent(sessionId)}` +
    `&school_code=${encodeURIComponent(schoolCode)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: headers(),
    cache: "no-store",
  });
  const data = await parseOrThrow(res, "list");
  return data.jobs ?? [];
}

export async function retryCombinedReportJob(
  jobId: string,
): Promise<CombinedReportJob> {
  const res = await fetch(
    `${reportingUrl()}/reports/combined/${encodeURIComponent(jobId)}/retry`,
    { method: "POST", headers: headers(), cache: "no-store" },
  );
  return parseOrThrow(res, "retry");
}
