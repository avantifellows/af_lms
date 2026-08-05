import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getTestDeepDiveFromDynamo } from "@/lib/dynamodb";
import { getTestALsByUser } from "@/lib/bigquery";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const gradeParam = url.searchParams.get("grade");
  const sessionId = url.searchParams.get("sessionId");

  if (!gradeParam || !sessionId) {
    return NextResponse.json(
      { error: "grade and sessionId are required" },
      { status: 400 }
    );
  }
  const grade = Number(gradeParam);
  if (!Number.isInteger(grade)) {
    return NextResponse.json({ error: "grade must be an integer" }, { status: 400 });
  }

  try {
    const program = url.searchParams.get("program") || undefined;
    const stream = url.searchParams.get("stream")?.toLowerCase() || undefined;
    const data = await getTestDeepDiveFromDynamo(
      auth.school.id,
      auth.school.name,
      grade,
      sessionId,
      program,
      stream
    );

    if (!data) {
      return NextResponse.json(
        { error: "No results available for this test yet. Please check back in a few hours." },
        { status: 404 }
      );
    }

    // AL lives in BigQuery, the rest of this payload in DynamoDB. Joined here
    // (rather than inside lib/dynamodb) so each lib module stays single-store.
    // Deliberately non-fatal: AL is one column, so a BQ hiccup should degrade
    // it to "—" rather than 500 the whole deep-dive.
    try {
      const alByUser = await getTestALsByUser(
        udise,
        grade,
        sessionId,
        program,
        stream
      );
      if (alByUser.size > 0) {
        data.students = data.students.map((s) => ({
          ...s,
          academic_level: s.enrollment_user_id
            ? alByUser.get(s.enrollment_user_id) ?? null
            : null,
        }));
      }
    } catch (alError) {
      console.error("Test deep dive AL join failed (column degrades to —):", alError);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Test deep dive error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test deep dive data" },
      { status: 500 }
    );
  }
}
