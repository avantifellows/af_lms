import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/permissions";
import Link from "next/link";
import { Card } from "@/components/ui";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">Admin</h1>
            <p className="text-xs text-text-muted">Manage users and permissions</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm font-bold text-accent hover:text-accent-hover uppercase">
              Dashboard
            </Link>
            <span className="text-sm text-text-muted font-mono hidden sm:inline">{session.user.email}</span>
            <Link
              href="/api/auth/signout"
              className="text-sm font-bold text-danger hover:text-danger/80"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/admin/users">
            <Card className="block p-6">
              <h3 className="text-lg font-bold text-text-primary uppercase tracking-wide">User Management</h3>
              <p className="mt-2 text-sm text-text-muted">
                Add, edit, and remove users. Assign permission levels.
              </p>
            </Card>
          </Link>

          <Link href="/admin/batches">
            <Card className="block p-6">
              <h3 className="text-lg font-bold text-text-primary uppercase tracking-wide">Batch Metadata</h3>
              <p className="mt-2 text-sm text-text-muted">
                Configure stream and grade metadata for program batches.
              </p>
            </Card>
          </Link>

          <Link href="/admin/schools">
            <Card className="block p-6">
              <h3 className="text-lg font-bold text-text-primary uppercase tracking-wide">School Programs</h3>
              <p className="mt-2 text-sm text-text-muted">
                Assign programs (CoE, Nodal, NVS) to schools.
              </p>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}
