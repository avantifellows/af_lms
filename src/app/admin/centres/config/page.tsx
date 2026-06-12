import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { authOptions } from "@/lib/auth";
import { getCentreOptionSets } from "@/lib/centres";
import { isAdmin } from "@/lib/permissions";
import CentreOptionConfig from "./CentreOptionConfig";

export default async function CentreOptionConfigPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    redirect("/dashboard");
  }

  const optionSetsResult = await getCentreOptionSets();

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-bg-card shadow-sm">
        <div className="flex w-full items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin/centres" className="-m-1 p-1 text-text-muted hover:text-text-primary">
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div>
              <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">
                Centre Options
              </h1>
              <p className="text-xs font-mono text-text-muted">{session.user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin/centres" className="text-sm font-bold uppercase text-accent hover:text-accent-hover">
              Centres
            </Link>
            <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        {optionSetsResult.ok ? (
          <CentreOptionConfig initialOptionSets={optionSetsResult.optionSets} />
        ) : (
          <div className="rounded-md border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
            Centre management schema unavailable
          </div>
        )}
      </main>
    </div>
  );
}
