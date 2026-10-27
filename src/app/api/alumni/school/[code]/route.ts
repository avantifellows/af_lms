import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authorizeAlumni } from "@/lib/alumni/access";
import { listAlumniForSchool, listPendingForSchool } from "@/lib/alumni/students";

/** The Alumni tab's two lists for one school: pass-outs to add, and existing alumni. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await authorizeAlumni({ schoolCode: code });
  if (!auth.ok) return auth.response;

  const [school] = await query<{ id: string; code: string }>(`SELECT id, code FROM school WHERE code = $1`, [code]);
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  try {
    const [pending, alumni] = await Promise.all([listPendingForSchool(school), listAlumniForSchool(school)]);
    return NextResponse.json({ pending, alumni });
  } catch (error) {
    console.error("[alumni/school]", error);
    return NextResponse.json({ error: "Couldn't load this school's students." }, { status: 500 });
  }
}
