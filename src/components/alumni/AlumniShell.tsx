import Link from "next/link";
import type { ReactNode } from "react";

// Page frame for the Alumni pages (/alumni, /alumni/[code]) — the home of the
// Alumni Manager role, which has no dashboard or school pages (ADR 0008).

interface Props {
  title: string;
  email: string;
  /** Link back to the Alumni home (school pages only). */
  back?: boolean;
  children: ReactNode;
}

export default function AlumniShell({ title, email, back, children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-6 sm:px-6 lg:px-8">
          <div>
            {back && (
              <Link href="/alumni" className="text-sm text-blue-600 hover:text-blue-500">
                ← All schools
              </Link>
            )}
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{email}</span>
            <Link href="/api/auth/signout" className="text-sm font-bold text-red-600 hover:text-red-500">
              Sign out
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function AlumniNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <p className="text-yellow-800">{children}</p>
    </div>
  );
}
