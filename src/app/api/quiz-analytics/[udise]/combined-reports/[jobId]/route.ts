import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { refuseOutsidePmuSession } from "@/lib/performance-session-pin";
import {
  getCombinedReportJob,
  ReportingServiceError,
} from "@/lib/reporting-service";

// GET /api/quiz-analytics/[udise]/combined-reports/[jobId]
// Poll a single job's status (+ presigned download_url when done).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ udise: string; jobId: string }> },
) {
  const { udise, jobId } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  try {
    const job = await getCombinedReportJob(jobId);
    // Defence-in-depth: a job_id is opaque, but make sure it belongs to the
    // school the caller is authorized for.
    if (job.school_code !== auth.school.code) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // A PMU caller only sees jobs for JNV NVS tests; any other job is out of
    // scope, so it 404s like another School's job.
    const outside = await refuseOutsidePmuSession(
      auth.permission,
      udise,
      job.session_id,
      404,
    );
    if (outside) return outside;
    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof ReportingServiceError && error.status === 404) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.error("Combined-report status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch job status" },
      { status: 502 },
    );
  }
}
