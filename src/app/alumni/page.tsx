import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listAlumniSchools } from "@/lib/alumni/schools";
import { getAlumniPermission, getFeatureAccess } from "@/lib/permissions";
import AlumniShell, { AlumniNotice } from "@/components/alumni/AlumniShell";
import FindAlumnus from "@/components/alumni/FindAlumnus";

// Alumni home: "Find an alumnus" (by AFID or name), then the schools in the
// person's scope with pass-outs to add or alumni on record. One school →
// straight to it.

export default async function AlumniHomePage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const permission = await getAlumniPermission(email);
  if (!permission || !getFeatureAccess(permission, "alumni").canView) {
    return (
      <AlumniShell title="Alumni" email={email}>
        <AlumniNotice>Your account ({email}) does not have access to alumni. Please contact an administrator.</AlumniNotice>
      </AlumniShell>
    );
  }

  const schools = await listAlumniSchools(permission);
  if (schools.length === 1) redirect(`/alumni/${encodeURIComponent(schools[0].code)}`);

  return (
    <AlumniShell title="Alumni" email={email}>
      <FindAlumnus />
      {schools.length === 0 ? (
        <AlumniNotice>None of your schools have pass-outs or alumni yet.</AlumniNotice>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg bg-white shadow">
          {schools.map((s) => (
            <li key={s.code}>
              <Link
                href={`/alumni/${encodeURIComponent(s.code)}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50"
              >
                <span>
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{s.code}</span>
                </span>
                <span className="text-sm text-gray-600">
                  {s.toAdd} to add · {s.alumni} alumni
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AlumniShell>
  );
}
