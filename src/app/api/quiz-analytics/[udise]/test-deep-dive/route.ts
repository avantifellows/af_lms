import { NextResponse } from "next/server";
import { authorizeSessionRead } from "@/lib/performance-session-request";
import { getTestDeepDiveFromDynamo } from "@/lib/dynamodb";
import { getStudentTimeSpentData, type StudentTimeSpent } from "@/lib/bigquery";
import { isNvsProgram } from "@/lib/constants";
import type { TestDeepDiveData } from "@/types/quiz";

// JNV NVS only: time spent comes from BigQuery, not the DynamoDB report doc.
// A failed lookup must not block the scores, so it degrades to "no times".
async function lookupTimeSpent(
  ...args: Parameters<typeof getStudentTimeSpentData>
): Promise<Map<string, StudentTimeSpent>> {
  try {
    return await getStudentTimeSpentData(...args);
  } catch (error) {
    // Message only — never the student rows or ids.
    console.error(
      "Test deep dive time-spent lookup failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return new Map();
  }
}

function withTimeSpent(
  data: TestDeepDiveData,
  times: Map<string, StudentTimeSpent>
): TestDeepDiveData {
  return {
    ...data,
    students: data.students.map((s) => {
      const t = s.enrollment_user_id ? times.get(s.enrollment_user_id) : undefined;
      return {
        ...s,
        time_spent_seconds: t?.overall ?? null,
        subject_scores: s.subject_scores.map((ss) => ({
          ...ss,
          time_spent_seconds: t?.bySection.get(ss.subject.toLowerCase()) ?? null,
        })),
      };
    }),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const read = await authorizeSessionRead(request, udise);
  if (!read.ok) return read.response;
  const { auth, program, grade, sessionId, stream } = read;

  try {
    const nvs = isNvsProgram(program);
    const [data, times] = await Promise.all([
      getTestDeepDiveFromDynamo(
        auth.school.id,
        auth.school.name,
        grade,
        sessionId,
        program,
        stream
      ),
      nvs ? lookupTimeSpent(udise, grade, sessionId, program, stream) : null,
    ]);

    if (!data) {
      return NextResponse.json(
        { error: "No results available for this test yet. Please check back in a few hours." },
        { status: 404 }
      );
    }

    return NextResponse.json(times ? withTimeSpent(data, times) : data);
  } catch (error) {
    console.error("Test deep dive error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test deep dive data" },
      { status: 500 }
    );
  }
}
