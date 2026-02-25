import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserPermission, getFeatureAccess, canAccessSchool } from "@/lib/permissions";
import NewVisitForm from "@/components/visits/NewVisitForm";

interface PageProps {
  params: Promise<{ udise: string }>;
}

export default async function NewVisitPage({ params }: PageProps) {
  const { udise } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/");
  }

  const permission = await getUserPermission(session.user.email);
  const visitAccess = getFeatureAccess(permission, "visits");

  if (!visitAccess.canEdit) {
    redirect("/");
  }

  // Check PM has access to this specific school
  const hasSchoolAccess = await canAccessSchool(session.user.email, udise);
  if (!hasSchoolAccess) {
    redirect(`/school/${udise}`);
  }

  return <NewVisitForm udise={udise} />;
}
