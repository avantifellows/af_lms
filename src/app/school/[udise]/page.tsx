import { query } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import RosterPage, { type RosterSchool } from "@/components/RosterPage";

async function getSchoolByCode(code: string): Promise<RosterSchool | null> {
  // Visible schools = the historical JNV set PLUS any school linked to an active
  // centre (the non-JNV centre rollout: Punjab CoE meritorious / EMRS). Mirrors
  // the dashboard `schoolScope` predicate so a school listed there also opens.
  const schools = await query<RosterSchool>(
    `SELECT
       s.id,
       s.name,
       s.code,
       s.udise_code,
       s.district,
       s.state,
       s.region,
       s.af_school_category,
       COALESCE(
         ARRAY_AGG(DISTINCT c.program_id) FILTER (WHERE c.program_id IS NOT NULL),
         ARRAY[]::int[]
       ) AS centre_program_ids
     FROM school s
     LEFT JOIN centres c ON c.school_id = s.id AND c.is_active = true
     WHERE (
         s.af_school_category = 'JNV'
         OR c.id IS NOT NULL
       )
       AND (s.udise_code = $1 OR s.code = $1)
     GROUP BY s.id, s.name, s.code, s.udise_code, s.district, s.state, s.region, s.af_school_category`,
    [code],
  );
  return schools[0] || null;
}

interface PageProps {
  params: Promise<{ udise: string }>;
}

export default async function SchoolPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  const { udise } = await params;

  if (!session) {
    redirect("/");
  }

  const school = await getSchoolByCode(udise);
  if (!school) {
    notFound();
  }

  return <RosterPage scope={{ kind: "school", school }} session={session} />;
}
