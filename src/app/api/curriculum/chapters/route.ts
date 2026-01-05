import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import type { Chapter, Topic, SubjectName, GradeNumber } from "@/types/curriculum";

// Subject name to ID mapping
const SUBJECT_NAME_TO_ID: Record<SubjectName, number> = {
  Maths: 1,
  Chemistry: 2,
  Physics: 4,
};

// Grade number to ID mapping
const GRADE_NUMBER_TO_ID: Record<GradeNumber, number> = {
  11: 3,
  12: 4,
};

interface ChapterRow {
  id: number;
  code: string;
  name: unknown; // JSONB - parsed by pg driver
  grade_id: number;
  grade_number: number;
  subject_id: number;
  subject_name: unknown; // JSONB - parsed by pg driver
}

interface TopicRow {
  id: number;
  code: string;
  name: unknown; // JSONB - parsed by pg driver
  chapter_id: number;
}

// Helper function to extract English name from JSONB array
// JSONB from PostgreSQL is already parsed by the pg driver
function extractEnglishName(jsonbData: unknown, field: string): string {
  try {
    // If it's a string (shouldn't happen with pg driver, but just in case)
    const parsed = typeof jsonbData === "string" ? JSON.parse(jsonbData) : jsonbData;

    if (Array.isArray(parsed)) {
      const english = parsed.find((item: Record<string, string>) => item.lang_code === "en");
      return english?.[field] || `Unknown ${field}`;
    }
    return `Unknown ${field}`;
  } catch {
    return `Unknown ${field}`;
  }
}

// GET /api/curriculum/chapters?grade=11&subject=Physics
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const gradeParam = searchParams.get("grade");
  const subjectParam = searchParams.get("subject");

  // Validate grade
  const grade = parseInt(gradeParam || "11", 10) as GradeNumber;
  if (grade !== 11 && grade !== 12) {
    return NextResponse.json(
      { error: "Grade must be 11 or 12" },
      { status: 400 }
    );
  }

  // Validate subject
  const subject = (subjectParam || "Physics") as SubjectName;
  if (!["Physics", "Chemistry", "Maths"].includes(subject)) {
    return NextResponse.json(
      { error: "Subject must be Physics, Chemistry, or Maths" },
      { status: 400 }
    );
  }

  const gradeId = GRADE_NUMBER_TO_ID[grade];
  const subjectId = SUBJECT_NAME_TO_ID[subject];

  try {
    // Fetch chapters for the given grade and subject
    const chaptersResult = await query<ChapterRow>(
      `SELECT
        ch.id,
        ch.code,
        ch.name,
        ch.grade_id,
        g.number as grade_number,
        ch.subject_id,
        s.name as subject_name
      FROM chapter ch
      JOIN grade g ON ch.grade_id = g.id
      JOIN subject s ON ch.subject_id = s.id
      WHERE ch.grade_id = $1 AND ch.subject_id = $2
      ORDER BY ch.code`,
      [gradeId, subjectId]
    );

    // Get all chapter IDs
    const chapterIds = chaptersResult.map((ch) => ch.id);

    // Fetch all topics for these chapters in one query
    let topicsResult: TopicRow[] = [];
    if (chapterIds.length > 0) {
      topicsResult = await query<TopicRow>(
        `SELECT id, code, name, chapter_id
        FROM topic
        WHERE chapter_id = ANY($1)
        ORDER BY code`,
        [chapterIds]
      );
    }

    // Group topics by chapter
    const topicsByChapter: Record<number, Topic[]> = {};
    for (const topic of topicsResult) {
      if (!topicsByChapter[topic.chapter_id]) {
        topicsByChapter[topic.chapter_id] = [];
      }
      topicsByChapter[topic.chapter_id].push({
        id: topic.id,
        code: topic.code,
        name: extractEnglishName(topic.name, "topic"),
        chapterId: topic.chapter_id,
      });
    }

    // Build chapters with topics
    const chapters: Chapter[] = chaptersResult.map((ch) => ({
      id: ch.id,
      code: ch.code,
      name: extractEnglishName(ch.name, "chapter"),
      grade: ch.grade_number,
      subjectId: ch.subject_id,
      subjectName: extractEnglishName(ch.subject_name, "subject"),
      topics: topicsByChapter[ch.id] || [],
    }));

    return NextResponse.json({ chapters });
  } catch (error) {
    console.error("Error fetching curriculum chapters:", error);
    return NextResponse.json(
      { error: "Failed to fetch chapters" },
      { status: 500 }
    );
  }
}
