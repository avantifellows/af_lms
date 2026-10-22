import Link from "next/link";

import type { BlendedLearningAccess } from "@/lib/blended-learning-access";

function accessLabel(access: BlendedLearningAccess) {
  if (access.kind === "mentor") return "Mentor";
  return access.readOnly ? "Blended Learning Admin · Read only" : "Blended Learning Admin";
}

// The section's own header, for the Blended Learning roles, who have no
// dashboard. An LMS user sees these pages inside the dashboard's chrome
// instead (BlendedPageShell).
// `wide`: match a page whose content is max-w-6xl (the Student list).
export function BlendedLearningHeader({ access, wide = false }: { access: BlendedLearningAccess; wide?: boolean }) {
  return (
    <header className="bg-bg-card border-b border-border shadow-sm">
      <div className={`mx-auto flex ${wide ? "max-w-6xl" : "max-w-5xl"} items-center justify-between gap-3 px-4 py-3 sm:px-6`}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            {/* Not a heading: each page has its own H1. */}
            <p className="text-lg font-bold uppercase tracking-tight text-text-primary sm:text-xl">
              Blended Learning
            </p>
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
