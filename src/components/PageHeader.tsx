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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {backHref && (
              <Link href={backHref} className="text-accent hover:text-accent-hover">
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
            <div>
              <h1 className="text-3xl font-bold text-text-primary">{title}</h1>
              {subtitle && (
                <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {actions}
            {userEmail && (
              <span className="text-sm text-text-secondary">{userEmail}</span>
            )}
            <Link
              href="/api/auth/signout"
              className="text-sm text-danger hover:text-danger/80 font-medium"
            >
              Sign out
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
