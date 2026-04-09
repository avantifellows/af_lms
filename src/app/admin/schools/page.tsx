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
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-text-muted hover:text-text-primary p-1 -m-1">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">School Programs</h1>
              <p className="text-xs text-text-muted font-mono">{schools.length} JNV schools</p>
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
        <SchoolList initialSchools={schools} />
      </main>
    </div>
  );
}
