import Link from "next/link";

import type { BlendedLearningAccess } from "@/lib/blended-learning-access";

function accessLabel(access: BlendedLearningAccess) {
  if (access.kind === "mentor") return "Mentor";
  return access.readOnly ? "Blended Learning Admin · Read only" : "Blended Learning Admin";
}

// `wide`: match a page whose content is max-w-6xl (the Student list).
export function BlendedLearningHeader({ access, wide = false }: { access: BlendedLearningAccess; wide?: boolean }) {
  // Only LMS admins have a dashboard to go back to; the Blended Learning
  // roles are denied everywhere else.
  const backToDashboard = access.role === "admin";
  return (
    <header className="bg-bg-card border-b border-border shadow-sm">
      <div className={`mx-auto flex ${wide ? "max-w-6xl" : "max-w-5xl"} items-center justify-between gap-3 px-4 py-3 sm:px-6`}>
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
