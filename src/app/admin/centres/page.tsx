import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { getCentreList, getCentreOptionSets } from "@/lib/centres";
import CentreGrid from "./CentreGrid";

interface CentresPageProps {
  searchParams?:
    | Promise<{ [key: string]: string | string[] | undefined }>
    | { [key: string]: string | string[] | undefined };
}

export default async function CentresPage({ searchParams }: CentresPageProps = {}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = searchParams
    ? await Promise.resolve(searchParams)
    : {};

  const [centresResult, optionSetsResult] = await Promise.all([
    getCentreList({ searchParams: resolvedSearchParams }),
    getCentreOptionSets(),
  ]);

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="flex w-full justify-between px-4 py-4 sm:px-6 lg:px-8 items-center">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-text-muted hover:text-text-primary p-1 -m-1">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">Centre Management</h1>
              <p className="text-xs text-text-muted font-mono">{session.user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/centres/config"
              className="text-sm font-bold uppercase text-accent hover:text-accent-hover"
            >
              Configure options
            </Link>
            <Link
              href="/api/auth/signout"
              className="text-sm font-bold text-danger hover:text-danger/80"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        {centresResult.ok && optionSetsResult.ok ? (
          <CentreGrid
            initialRows={centresResult.rows}
            initialSummary={centresResult.summary}
            initialFilters={centresResult.filters}
            initialPagination={centresResult.pagination}
            optionSets={optionSetsResult.optionSets}
          />
        ) : (
          <div className="rounded-md border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
            Centre management schema unavailable
          </div>
        )}
      </main>
    </div>
  );
}
