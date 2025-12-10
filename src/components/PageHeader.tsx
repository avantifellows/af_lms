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
    <header className="bg-white shadow">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {backHref && (
              <Link href={backHref} className="text-gray-500 hover:text-gray-700">
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
              <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
              {subtitle && (
                <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {actions}
            {userEmail && (
              <span className="text-sm text-gray-500">{userEmail}</span>
            )}
            <Link
              href="/api/auth/signout"
              className="text-sm text-red-600 hover:text-red-800"
            >
              Sign out
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
