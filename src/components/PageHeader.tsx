import Link from "next/link";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  userEmail?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({
  title,
  subtitle,
  backHref,
  userEmail,
  actions,
}: PageHeaderProps) {
  return (
    <header className="bg-bg-card border-b-2 border-accent shadow-sm">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {backHref && (
              <Link href={backHref} className="text-accent hover:text-accent-hover mt-1 shrink-0 p-1 -m-1">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </Link>
            )}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-bold text-text-primary">{title}</h1>
              {subtitle && (
                <p className="mt-1 text-xs sm:text-sm text-text-secondary break-words">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {actions}
            {userEmail && (
              <span className="text-sm text-text-secondary hidden sm:inline">{userEmail}</span>
            )}
            <Link
              href="/api/auth/signout"
              className="text-sm text-danger hover:text-danger/80 font-medium whitespace-nowrap"
            >
              Sign out
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
