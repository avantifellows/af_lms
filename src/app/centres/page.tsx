import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getResolvedPermission } from "@/lib/permissions";
import { centresForUserList } from "@/lib/centre-batch";
import PageHeader from "@/components/PageHeader";
import CentreCard from "@/components/CentreCard";
import { Card } from "@/components/ui";

export default async function CentresPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const permission = await getResolvedPermission(session.user.email);
  const centres = permission?.scope?.centres;

  const list = centres ? await centresForUserList(centres) : [];

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="My Centres"
        subtitle="Centres you are assigned to"
        backHref="/dashboard"
        userEmail={session.user.email}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {list.length === 0 ? (
          <Card elevation="sm" className="border-dashed p-8 text-center">
            <p className="text-sm text-text-muted">
              You are not assigned to any centres yet.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((centre) => (
              <CentreCard
                key={centre.id}
                centre={centre}
                href={`/centre/${centre.id}`}
                showBatchCount
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
