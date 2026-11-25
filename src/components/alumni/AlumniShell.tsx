import Link from "next/link";
import type { ReactNode } from "react";
import { PAGE_TITLE_CLASS } from "@/components/PageHeader";
import { Card } from "@/components/ui";

// Page frame for the Alumni pages (/alumni, /alumni/[code], /alumni/record):
// the LMS dashboard's header (logo, nav, account) with Alumni selected, then a
// title row. Alumni Managers have no dashboard (ADR 0008), so they get no Home.

interface Props {
  title: string;
  subtitle?: string;
  email: string;
  /** Show "Home" (the dashboard). False for Alumni Managers, who have none. */
  showHome?: boolean;
  /** Back arrow to the Alumni home (school and record pages). */
  back?: boolean;
  /** Buttons at the right of the title row. */
  actions?: ReactNode;
  children: ReactNode;
}

const NAV_LINK = "text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-1";
const NAV_CURRENT = "text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-1";

export default function AlumniShell({ title, subtitle, email, showHome = false, back, actions, children }: Props) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp" alt="Avanti Fellows" className="h-8 shrink-0 sm:h-10" />
            <nav className="flex gap-3 sm:gap-4">
              {showHome && <Link href="/dashboard" className={NAV_LINK}>Home</Link>}
              <Link href="/alumni" aria-current="page" className={NAV_CURRENT}>Alumni</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="hidden font-mono text-sm text-text-muted sm:inline">{email}</span>
            <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">Sign out</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          {back && (
            <Link href="/alumni" aria-label="All schools" className="-m-1 shrink-0 p-1 text-text-muted hover:text-text-primary">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
            {subtitle && <p className="break-words text-xs text-text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}

export function AlumniNotice({ children }: { children: ReactNode }) {
  return (
    <Card elevation="sm" className="border-l-4 border-l-brand-amber p-4">
      <p className="text-sm text-text-secondary">{children}</p>
    </Card>
  );
}
