import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-guard";
import { authOptions } from "@/lib/auth";
import { listOpenFlags } from "@/lib/intervention-flags";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

// Open intervention flags across every school. Flags are raised and resolved
// from each school's Enrollment tab; this page is the admin overview.
export default async function AdminInterventionFlagsPage() {
  const session = await getServerSession(authOptions);
  const access = await requireAdmin(session);
  if (!access.ok) redirect(access.status === 401 ? "/" : "/dashboard");

  const flags = await listOpenFlags("all");

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">
              Students needing intervention
            </h1>
            <p className="text-xs text-text-muted">
              Open flags across all schools. Open a school&apos;s Enrollment tab to add notes or
              resolve.
            </p>
          </div>
          <Link href="/admin" className="text-sm font-bold text-accent hover:text-accent-hover uppercase">
            Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {flags.length === 0 ? (
          <Card elevation="sm" className="p-8 text-center text-sm text-text-muted">
            No open intervention flags.
          </Card>
        ) : (
          <div className="space-y-3">
            {flags.map((flag) => (
              <Card key={flag.id} elevation="sm" className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-text-primary">
                      {flag.student_name || "—"}
                    </h2>
                    <Link
                      href={`/school/${encodeURIComponent(flag.school_udise || flag.school_code)}`}
                      className="text-sm text-accent hover:text-accent-hover"
                    >
                      {flag.school_name}
                    </Link>
                  </div>
                  <p className="text-xs text-text-muted">
                    Flagged {formatDate(flag.inserted_at)} by {flag.raised_by_email} · last update{" "}
                    {formatDate(flag.latest_at)}
                  </p>
                </div>
                {flag.latest_note && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">
                    {flag.latest_note}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
