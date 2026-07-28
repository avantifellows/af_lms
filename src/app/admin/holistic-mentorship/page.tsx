import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import HolisticMentorshipWorkspace from "@/components/holistic-mentorship/HolisticMentorshipWorkspace";
import PageHeader from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

export default async function HolisticMentorshipAdminPage() {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "program_read");
  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <PageHeader
        title="Holistic Mentorship"
        subtitle="Program-wide mentorship setup and progress."
        backHref={access.permission.role === "admin" ? "/dashboard" : undefined}
        userEmail={session?.user?.email ?? undefined}
        actions={
          <span className="rounded-full bg-info-bg px-3 py-1.5 text-xs font-extrabold text-info">
            Mentorship Admin
          </span>
        }
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <HolisticMentorshipWorkspace mode="admin" />
      </main>
    </div>
  );
}
