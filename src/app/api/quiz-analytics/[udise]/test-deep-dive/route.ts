import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getTestDeepDiveFromDynamo } from "@/lib/dynamodb";

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
    const data = await getTestDeepDiveFromDynamo(auth.school.id, grade, sessionId, program);

    if (!data) {
      return NextResponse.json(
        { error: "No results found for this test" },
        { status: 404 }
      );
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
