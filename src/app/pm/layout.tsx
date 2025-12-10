import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canAccessPMFeatures } from "@/lib/permissions";
import Link from "next/link";

export default async function PMLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const canAccess = await canAccessPMFeatures(session.user.email);
  if (!canAccess) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-6">
              <Link href="/pm" className="text-xl font-bold text-gray-900">
                Program Manager
              </Link>
              <nav className="flex gap-4">
                <Link
                  href="/pm"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Schools
                </Link>
                <Link
                  href="/pm/visits"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Visits
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">{session.user.email}</span>
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
      {children}
    </div>
  );
}
