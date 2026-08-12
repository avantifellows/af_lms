import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import {
  getSchoolRoster,
  filterActiveRosterStudents,
} from "@/lib/school-students";
import {
  submitCombinedReport,
  listCombinedReportJobs,
  ReportingServiceError,
} from "@/lib/reporting-service";
import {
  getSessionWindow,
  evaluateGenerationEligibility,
  BLOCKED_MESSAGE,
} from "@/lib/combined-report-eligibility";

// GET /api/quiz-analytics/[udise]/combined-reports?session_id=...
// List the combined-report jobs for this school + test (the Performance-tab view).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> },
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    const jobs = await listCombinedReportJobs(sessionId, auth.school.code);
    // The panel renders its button from this, so it needs the same verdict the
    // POST route will apply — otherwise the button invites a click that 409s.
    const window = await getSessionWindow(sessionId);
    const eligibility = evaluateGenerationEligibility(window, jobs);
    return NextResponse.json({
      jobs,
      session_end_time: window.endTimeUtcIso,
      can_generate: eligibility.allowed,
      blocked_reason: eligibility.reason ?? null,
      blocked_message: eligibility.reason
        ? BLOCKED_MESSAGE[eligibility.reason]
        : null,
    });
  } catch (error) {
    if (error instanceof ReportingServiceError) {
      console.error("Combined-report list error:", error.status, error.body);
    } else {
      console.error("Combined-report list error:", error);
    }
    return NextResponse.json(
      { error: "Failed to list report jobs" },
      { status: 502 },
    );
  }
}

// POST /api/quiz-analytics/[udise]/combined-reports
// Body: { session_id, test_name?, grade?, program?, stream? }
// Builds the school roster (optionally narrowed to the test's grade/program/
// stream) and submits a combined-report job to the reporting engine.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ udise: string }> },
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  let body: {
    session_id?: string;
    test_name?: string;
    grade?: number;
    program?: string;
    stream?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.session_id) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    // Gate before doing any work: the session must have closed, and this test
    // must not already have a finished or in-flight report.
    const [window, existingJobs] = await Promise.all([
      getSessionWindow(body.session_id),
      listCombinedReportJobs(body.session_id, auth.school.code),
    ]);
    const eligibility = evaluateGenerationEligibility(window, existingJobs);
    if (!eligibility.allowed && eligibility.reason) {
      return NextResponse.json(
        {
          error: BLOCKED_MESSAGE[eligibility.reason],
          reason: eligibility.reason,
          session_end_time: window.endTimeUtcIso,
        },
        { status: 409 },
      );
    }

    const { students: roster } = await getSchoolRoster(auth.school.id);
    // Narrow to the cohort the test belongs to (and drop dropouts), so the
    // combined report matches what the teacher sees for this test.
    const students = filterActiveRosterStudents(roster, {
      grade: body.grade,
      program: body.program,
      stream: body.stream,
    }).map((s) => ({
      user_id: s.user_id != null ? String(s.user_id) : null,
      student_id: s.student_id != null ? String(s.student_id) : null,
      apaar_id: s.apaar_id != null ? String(s.apaar_id) : null,
    }));

    if (students.length === 0) {
      return NextResponse.json(
        { error: "No active students found for this school/cohort" },
        { status: 400 },
      );
    }

    const session = await getServerSession(authOptions);
    const result = await submitCombinedReport({
      sessionId: body.session_id,
      testName: body.test_name ?? null,
      school: {
        udise,
        code: auth.school.code,
        name: auth.school.name,
      },
      students,
      requestedBy: session?.user?.email ?? null,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof ReportingServiceError) {
      console.error("Combined-report submit error:", error.status, error.body);
    } else {
      console.error("Combined-report submit error:", error);
    }
    return NextResponse.json(
      { error: "Failed to submit report job" },
      { status: 502 },
    );
  }
}
