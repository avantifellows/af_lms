import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import {
  canBlendedLearning,
  getBlendedLearningAccess,
  type BlendedLearningAccess,
} from "@/lib/blended-learning-access";

function accessLabel(access: BlendedLearningAccess) {
  if (access.kind === "mentor") return "Mentor";
  return access.readOnly ? "Blended Learning Admin · Read only" : "Blended Learning Admin";
}

function BlendedLearningHeader({ access }: { access: BlendedLearningAccess }) {
  // Only LMS admins have a dashboard to go back to; the Blended Learning
  // roles are denied everywhere else.
  const backToDashboard = access.role === "admin";
  return (
    <header className="bg-bg-card border-b border-border shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {backToDashboard && (
            <Link
              href="/dashboard"
              aria-label="Back to dashboard"
              className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center text-text-muted hover:text-text-primary"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-bold uppercase tracking-tight text-text-primary sm:text-xl">
              Blended Learning
            </h1>
            <p className="text-xs text-text-muted">{accessLabel(access)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden font-mono text-sm text-text-muted sm:inline">{access.actorEmail}</span>
          <Link
            href="/api/auth/signout"
            className="flex min-h-11 items-center text-sm font-bold text-danger hover:text-danger/80"
          >
            Sign out
          </Link>
        </div>
      </div>
    </header>
  );
}

// Landing page for the Blended Learning section. The Mentee list (Mentors)
// and the Mentors and Flags tabs (admins) fill this in later.
export default async function BlendedLearningPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const access = await getBlendedLearningAccess(email);
  if (!access || !canBlendedLearning(access, "view_list")) redirect("/dashboard");

  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Card elevation="sm" className="p-4 sm:p-6">
          <p className="text-sm text-text-secondary">
            {access.kind === "mentor"
              ? "Your Mentees will appear here."
              : "Mentors and Mentor Flags will appear here."}
          </p>
        </Card>
      </main>
    </>
  );
}
