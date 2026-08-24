import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessQuizSessionSchool,
  requireQuizSessionAccess,
} from "@/lib/quiz-session-access";
import { query } from "@/lib/db";

interface BatchRow {
  // batch.id/parent_id/program_id are numeric columns, which node-pg hands back
  // as strings ("1", not 1). They are coerced once before the response so the
  // BatchOption contract clients code against is honestly numeric — the centre
  // page filters batches with `b.program_id === programId`, and a string "1"
  // never equals the number 1, which silently emptied the list.
  id: number | string;
  name: string;
  batch_id: string;
  parent_id: number | string | null;
  program_id: number | string | null;
}

function toBatchOption(row: BatchRow) {
  return {
    id: Number(row.id),
    name: row.name,
    batch_id: row.batch_id,
    parent_id: row.parent_id === null ? null : Number(row.parent_id),
    program_id: row.program_id === null ? null : Number(row.program_id),
  };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const schoolIdParam = searchParams.get("schoolId");

  if (!schoolIdParam) {
    return NextResponse.json({ error: "schoolId is required" }, { status: 400 });
  }

  const schoolId = Number(schoolIdParam);
  if (Number.isNaN(schoolId)) {
    return NextResponse.json({ error: "Invalid schoolId" }, { status: 400 });
  }

  const access = await requireQuizSessionAccess(session.user.email, "view");
  if (!access.ok) {
    return access.response;
  }

  if (!(await canAccessQuizSessionSchool(access.permission, schoolId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const programIds = access.permission.program_ids ?? [];

  if (programIds.length === 0) {
    return NextResponse.json({ batches: [] });
  }

  // Scope to the PM's authorized programs. (Previously also filtered
  // batch_id LIKE 'EnableStudents_%', which wrongly hid EMRS/Punjab/Gujarat
  // batches even when the PM had those programs — program_id is the real scope.)
  const baseFilters = `
    b.program_id = ANY($2::int[])
  `;

  let batches = await query<BatchRow>(
    `
    SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
    FROM school_batch sb
    JOIN batch b ON b.id = sb.batch_id
    WHERE sb.school_id = $1
      AND ${baseFilters}
    ORDER BY b.name
    `,
    [schoolId, programIds]
  );

  if (batches.length === 0) {
    batches = await query<BatchRow>(
      `
      SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
      FROM batch b
      WHERE b.program_id = ANY($1::int[])
      ORDER BY b.name
      `,
      [programIds]
    );
  }

  const parentIds = Array.from(
    new Set(
      batches
        .map((b) => (b.parent_id === null ? null : Number(b.parent_id)))
        .filter((id): id is number => id !== null)
    )
  );
  const knownIds = new Set(batches.map((b) => Number(b.id)));
  const missingParentIds = parentIds.filter((id) => !knownIds.has(id));

  if (missingParentIds.length > 0) {
    const parentRows = await query<BatchRow>(
      `
      SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
      FROM batch b
      WHERE b.id = ANY($1::int[])
      ORDER BY b.name
      `,
      [missingParentIds]
    );
    batches = batches.concat(parentRows);
  }

  return NextResponse.json({ batches: batches.map(toBatchOption) });
}
