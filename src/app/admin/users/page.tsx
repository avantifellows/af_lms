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
  read_only: boolean;
}

interface Region {
  region: string;
  school_count: string;
}

async function getUsers(): Promise<UserPermission[]> {
  return query<UserPermission>(
    `SELECT id, email, level, role, school_codes, regions, read_only
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-500 hover:text-gray-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
              <p className="mt-1 text-sm text-gray-500">{users.length} users</p>
            </div>
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
