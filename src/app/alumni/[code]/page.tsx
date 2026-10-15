import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { reachesSchool } from "@/lib/alumni/access";
import { getSchoolName } from "@/lib/alumni/schools";
import { getAlumniPermission, getFeatureAccess } from "@/lib/permissions";
import AlumniShell, { AlumniNotice } from "@/components/alumni/AlumniShell";
import AlumniTab from "@/components/alumni/AlumniTab";

// One school's alumni: pass-outs to add and existing alumni (the same view as
// the school page's Alumni tab), for anyone with the alumni feature.

export default async function AlumniSchoolPage({ params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const { code } = await params;
  const name = await getSchoolName(code);
  if (!name) notFound();

  const permission = await getAlumniPermission(email);
  const allowed =
    !!permission && getFeatureAccess(permission, "alumni").canView && (await reachesSchool(permission, code));
  if (!allowed) {
    return (
      <AlumniShell title="Alumni" email={email} back>
        <AlumniNotice>You don&apos;t have access to this school&apos;s alumni.</AlumniNotice>
      </AlumniShell>
    );
  }

  return (
    <AlumniShell title={`${name} · Alumni`} email={email} back>
      <AlumniTab schoolCode={code} />
    </AlumniShell>
  );
}
