import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";

interface BatchRow {
  id: number;
  name: string;
  batch_id: string;
  parent_id: number | null;
  program_id: number | null;
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

  const permission = await getUserPermission(session.user.email);
  const programIds = permission?.program_ids ?? [];

  if (programIds.length === 0) {
    return NextResponse.json({ batches: [] });
  }

  const baseFilters = `
    b.program_id = ANY($2::int[])
    AND b.batch_id LIKE 'EnableStudents_%'
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
        AND b.batch_id LIKE 'EnableStudents_%'
      ORDER BY b.name
      `,
      [programIds]
    );
  }

  const parentIds = Array.from(
    new Set(batches.map((b) => b.parent_id).filter((id): id is number => id !== null))
  );
  const knownIds = new Set(batches.map((b) => b.id));
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

  return NextResponse.json({ batches });
}
