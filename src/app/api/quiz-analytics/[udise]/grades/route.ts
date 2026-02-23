import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getAvailableGrades } from "@/lib/bigquery";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  const grades = await getAvailableGrades(udise);
  return NextResponse.json({ grades });
}
