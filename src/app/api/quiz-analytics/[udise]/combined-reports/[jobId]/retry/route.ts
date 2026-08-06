import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import {
  getCombinedReportJob,
  retryCombinedReportJob,
  ReportingServiceError,
} from "@/lib/reporting-service";

// POST /api/quiz-analytics/[udise]/combined-reports/[jobId]/retry
// Re-enqueue an errored job.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ udise: string; jobId: string }> },
) {
  const { udise, jobId } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  try {
    // Confirm the job belongs to this school before retrying.
    const existing = await getCombinedReportJob(jobId);
    if (existing.school_code !== auth.school.code) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const job = await retryCombinedReportJob(jobId);
    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof ReportingServiceError) {
      if (error.status === 404) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      if (error.status === 409) {
        return NextResponse.json(
          { error: "Only errored jobs can be retried" },
          { status: 409 },
        );
      }
    }
    console.error("Combined-report retry error:", error);
    return NextResponse.json(
      { error: "Failed to retry job" },
      { status: 502 },
    );
  }
}
