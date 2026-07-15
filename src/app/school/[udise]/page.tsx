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
    `SELECT id, name, code, udise_code, district, state, region
     FROM school s
     WHERE (
         s.af_school_category = 'JNV'
         OR EXISTS (SELECT 1 FROM centres c WHERE c.school_id = s.id AND c.is_active)
       )
       AND (s.udise_code = $1 OR s.code = $1)`,
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
