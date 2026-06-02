import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getCurriculumConfigImpact,
  requireCurriculumConfigAdmin,
} from "@/lib/curriculum-config";
import type { ExamTrack } from "@/types/curriculum";

const EXAM_TRACKS: ExamTrack[] = ["jee_main", "jee_advanced", "neet"];

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumConfigAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const chapterId = Number.parseInt(
    request.nextUrl.searchParams.get("chapter_id") ?? "",
    10
  );
  const examTrack = request.nextUrl.searchParams.get("exam_track");
  const configId = positiveInteger(request.nextUrl.searchParams.get("config_id"));
  const coverageSequence = positiveInteger(
    request.nextUrl.searchParams.get("coverage_sequence")
  );
  const prescribedMinutes = nonNegativeInteger(
    request.nextUrl.searchParams.get("prescribed_minutes")
  );
  const isInSyllabus =
    request.nextUrl.searchParams.get("is_in_syllabus") === "true"
      ? true
      : request.nextUrl.searchParams.get("is_in_syllabus") === "false"
        ? false
        : undefined;

  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    return NextResponse.json(
      { error: "Invalid impact request", fields: { chapter_id: "Chapter id is required" } },
      { status: 422 }
    );
  }
  if (!EXAM_TRACKS.includes(examTrack as ExamTrack)) {
    return NextResponse.json(
      { error: "Invalid impact request", fields: { exam_track: "Invalid Exam Track" } },
      { status: 422 }
    );
  }

  const result = await getCurriculumConfigImpact({
    chapterId,
    examTrack: examTrack as ExamTrack,
    configId: configId ?? undefined,
    coverageSequence: coverageSequence ?? undefined,
    prescribedMinutes: prescribedMinutes ?? undefined,
    isInSyllabus,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({
    counts: result.counts,
    warnings: result.warnings,
  });
}

function positiveInteger(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
