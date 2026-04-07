import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import UserList from "./UserList";

interface UserPermission {
  id: number;
  email: string;
  level: number;
  role: string;
  school_codes: string[] | null;
  regions: string[] | null;
  program_ids: number[] | null;
  read_only: boolean;
  full_name: string | null;
}

interface Region {
  region: string;
  school_count: string;
}

async function getUsers(): Promise<UserPermission[]> {
  return query<UserPermission>(
    `SELECT id, email, level, role, school_codes, regions, program_ids, read_only, full_name
     FROM user_permission
     ORDER BY level DESC, role, email`
  );
}

async function getRegions(): Promise<Region[]> {
  return query<Region>(
    `SELECT region, COUNT(*) as school_count
     FROM school
     WHERE af_school_category = 'JNV' AND region IS NOT NULL AND region != ''
     GROUP BY region
     ORDER BY region`
  );
}

export default async function UsersPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    redirect("/dashboard");
  }

  const [users, regions] = await Promise.all([getUsers(), getRegions()]);

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b-2 border-accent shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-text-muted hover:text-text-primary p-1 -m-1">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">User Management</h1>
              <p className="text-xs text-text-muted font-mono">{users.length} users</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
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
        <UserList
          initialUsers={users}
          regions={regions.map(r => r.region)}
          currentUserEmail={session.user.email}
        />
      </main>
    </div>
  );
}
