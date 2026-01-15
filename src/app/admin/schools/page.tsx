import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import SchoolList from "./SchoolList";

interface School {
  id: number;
  code: string;
  name: string;
  region: string;
  program_ids: number[] | null;
}

async function getSchools(): Promise<School[]> {
  return query<School>(
    `SELECT id, code, name, region, program_ids
     FROM school
     WHERE af_school_category = 'JNV'
     ORDER BY name`
  );
}

export default async function SchoolsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    redirect("/dashboard");
  }

  const schools = await getSchools();

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
              <h1 className="text-3xl font-bold text-gray-900">School Programs</h1>
              <p className="mt-1 text-sm text-gray-500">{schools.length} JNV schools</p>
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
        <SchoolList initialSchools={schools} />
      </main>
    </div>
  );
}
