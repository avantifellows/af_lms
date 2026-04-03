import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getAvailableGrades, getAvailablePrograms } from "@/lib/bigquery";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const program = url.searchParams.get("program") || undefined;

  try {
    const [grades, programs] = await Promise.all([
      getAvailableGrades(udise, program),
      getAvailablePrograms(udise),
    ]);
    return NextResponse.json({ grades, programs });
  } catch (error) {
    console.error("Grades fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch available grades" },
      { status: 500 }
    );
  }
}
