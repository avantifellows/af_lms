import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getCurriculumConfigChapterOptions,
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

  const examTrack = request.nextUrl.searchParams.get("exam_track");
  if (!EXAM_TRACKS.includes(examTrack as ExamTrack)) {
    return NextResponse.json(
      {
        error: "Invalid chapter option request",
        fields: { exam_track: "Invalid Exam Track" },
      },
      { status: 422 }
    );
  }

  const params = {
    examTrack: examTrack as ExamTrack,
    grade: positiveInteger(request.nextUrl.searchParams.get("grade")),
    subject: request.nextUrl.searchParams.get("subject")?.trim() || null,
    search: request.nextUrl.searchParams.get("search")?.trim() ?? "",
  };
  const result = await getCurriculumConfigChapterOptions(params);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({
    options: result.options,
    filters: params,
  });
}

function positiveInteger(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
