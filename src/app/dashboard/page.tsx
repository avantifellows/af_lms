import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAccessibleSchoolCodes, getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import SearchBox from "./SearchBox";
import StudentSearch from "@/components/StudentSearch";

interface School {
  id: string;
  code: string;
  name: string;
  district: string;
  state: string;
  region: string;
}

async function getSchools(
  codes: string[] | "all",
  search?: string
): Promise<School[]> {
  const searchPattern = search ? `%${search}%` : null;

  if (codes === "all") {
    if (searchPattern) {
      return query<School>(
        `SELECT id, code, name, district, state, region
         FROM school
         WHERE af_school_category = 'JNV'
           AND (name ILIKE $1 OR code ILIKE $1 OR district ILIKE $1)
         ORDER BY name
         LIMIT 100`,
        [searchPattern]
      );
    }
    return query<School>(
      `SELECT id, code, name, district, state, region
       FROM school
       WHERE af_school_category = 'JNV'
       ORDER BY name
       LIMIT 100`
    );
  }

  if (codes.length === 0) return [];

  if (searchPattern) {
    return query<School>(
      `SELECT id, code, name, district, state, region
       FROM school
       WHERE af_school_category = 'JNV'
         AND code = ANY($1)
         AND (name ILIKE $2 OR code ILIKE $2 OR district ILIKE $2)
       ORDER BY name`,
      [codes, searchPattern]
    );
  }

  return query<School>(
    `SELECT id, code, name, district, state, region
     FROM school
     WHERE af_school_category = 'JNV'
       AND code = ANY($1)
     ORDER BY name`,
    [codes]
  );
}

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const { q: searchQuery } = await searchParams;

  if (!session?.user?.email) {
    redirect("/");
  }

  // Check if passcode user - redirect to their school
  if ((session as any).isPasscodeUser && (session as any).schoolCode) {
    redirect(`/school/${(session as any).schoolCode}`);
  }

  const permission = await getUserPermission(session.user.email);

  if (!permission) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <div className="text-sm text-gray-500">{session.user.email}</div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="rounded-lg bg-yellow-50 p-4 border border-yellow-200">
            <p className="text-yellow-800">
              Your account ({session.user.email}) does not have access to any schools.
              Please contact an administrator.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const schoolCodes = await getAccessibleSchoolCodes(session.user.email);
  const schools = await getSchools(schoolCodes, searchQuery);

  // If user has access to only one school and no search, redirect directly
  if (schoolCodes !== "all" && schoolCodes.length === 1 && !searchQuery) {
    redirect(`/school/${schoolCodes[0]}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Schools</h1>
            <p className="mt-1 text-sm text-gray-500">
              {permission.level === 4
                ? "Admin access"
                : permission.level === 3
                ? "All schools access"
                : permission.level === 2
                ? `Region access: ${permission.regions?.join(", ")}`
                : `${schools.length} school(s)`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {permission.level === 4 && (
              <Link
                href="/admin"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Admin
              </Link>
            )}
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
        <div className="mb-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Students
            </label>
            <StudentSearch />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Schools
            </label>
            <SearchBox defaultValue={searchQuery} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schools.map((school) => (
            <Link
              key={school.id}
              href={`/school/${school.code}`}
              className="block rounded-lg bg-white p-6 shadow hover:shadow-md transition-shadow"
            >
              <h3 className="font-semibold text-gray-900">{school.name}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {school.district}, {school.state}
              </p>
              <p className="mt-2 text-xs text-gray-400">Code: {school.code}</p>
            </Link>
          ))}
        </div>

        {schools.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {searchQuery
              ? `No schools found matching "${searchQuery}"`
              : "No schools found"}
          </div>
        )}
      </main>
    </div>
  );
}
