import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getAvailableGrades, getAvailablePrograms } from "@/lib/bigquery";
import {
  PROGRAM_ID_TO_LABEL,
  getUserPermission,
} from "@/lib/permissions";

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
    const [grades, allPrograms] = await Promise.all([
      getAvailableGrades(udise, program),
      getAvailablePrograms(udise),
    ]);

    // Restrict program tabs to the ones the user is assigned to.
    // Passcode users and admins see every program available for the school.
    const session = await getServerSession(authOptions);
    let programs = allPrograms;
    if (session && !session.isPasscodeUser && session.user?.email) {
      const permission = await getUserPermission(session.user.email);
      if (permission && permission.role !== "admin") {
        const allowedLabels = new Set(
          (permission.program_ids || [])
            .map((id) => PROGRAM_ID_TO_LABEL[id])
            .filter((label): label is string => Boolean(label))
        );
        programs = allPrograms.filter((p) => allowedLabels.has(p));
      }
    }

    return NextResponse.json({ grades, programs });
  } catch (error) {
    console.error("Grades fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch available grades" },
      { status: 500 }
    );
  }
}
