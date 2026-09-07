import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import RosterPage from "@/components/RosterPage";
import { getCentreWithSchool } from "@/lib/dashboard-groupings";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CentrePage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session) {
    redirect("/");
  }

  const centre = await getCentreWithSchool(id);
  // A centre needs a parent school for its school-keyed tabs (Visits/Performance
  // /etc.). School-less (city) centres aren't browsable yet — that lands with
  // the batch-tag leg.
  if (!centre || !centre.school) {
    notFound();
  }

  return (
    <RosterPage
      scope={{
        kind: "centre",
        school: centre.school,
        centre: {
          id: centre.id,
          name: centre.name,
          program_id: centre.program_id,
          program_name: centre.program_name,
        },
      }}
      session={session}
    />
  );
}
