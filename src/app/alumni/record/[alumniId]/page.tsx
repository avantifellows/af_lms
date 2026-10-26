import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessAlumni, getAlumniPermission, getFeatureAccess } from "@/lib/permissions";
import AlumniShell, { AlumniNotice } from "@/components/alumni/AlumniShell";
import AlumniForm from "@/components/alumni/AlumniForm";

// One alumnus opened from "Find an alumnus", by alumni.id. Gated by
// canAccessAlumni (ADR 0008); reaches alumni with no School on record too.

export default async function AlumniRecordPage({ params }: { params: Promise<{ alumniId: string }> }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const { alumniId } = await params;
  const allowed = /^\d+$/.test(alumniId) && (await canAccessAlumni(session, alumniId));
  if (!allowed) {
    return (
      <AlumniShell title="Alumni" email={email} back>
        <AlumniNotice>You don&apos;t have access to this alumnus.</AlumniNotice>
      </AlumniShell>
    );
  }

  const canEdit = getFeatureAccess(await getAlumniPermission(email), "alumni").canEdit;
  return (
    <AlumniShell title="Alumni record" email={email} back>
      <div className="rounded-xl bg-white p-6 shadow">
        <AlumniForm entry={{ kind: "alumnus", id: alumniId }} canEdit={canEdit} />
      </div>
    </AlumniShell>
  );
}
