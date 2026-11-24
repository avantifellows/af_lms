import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAlumniRole } from "@/lib/constants";
import { listAlumniSchools, loadAlumniTotals, type AlumniSchool, type AlumniTotals as Totals } from "@/lib/alumni/schools";
import { getAlumniPermission, getFeatureAccess } from "@/lib/permissions";
import AlumniShell, { AlumniNotice } from "@/components/alumni/AlumniShell";
import AlumniDataTable from "@/components/alumni/AlumniDataTable";
import FindAlumnus from "@/components/alumni/FindAlumnus";
import MassRestore from "@/components/alumni/MassRestore";
import { journeyEnabled } from "@/lib/alumni/journey";
import { reachesAllSchools } from "@/lib/alumni/scope";
import StatCard from "@/components/StatCard";
import { Card } from "@/components/ui";

// Alumni home: totals (alumni, studying, employed), "Find an alumnus" (by AFID or name), then the schools
// in the person's scope with pass-outs to add or alumni on record. One school
// → straight to it.

type HomeView = "schools" | "table";

export default async function AlumniHomePage({ searchParams }: { searchParams?: Promise<{ view?: string }> } = {}) {
  const view: HomeView = (await searchParams)?.view === "table" ? "table" : "schools";
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const permission = await getAlumniPermission(email);
  if (!permission || !getFeatureAccess(permission, "alumni").canView) {
    return (
      <AlumniShell title="Alumni" email={email} showHome>
        <AlumniNotice>Your account ({email}) does not have access to alumni. Please contact an administrator.</AlumniNotice>
      </AlumniShell>
    );
  }

  const [schools, totals] = await Promise.all([listAlumniSchools(permission), loadAlumniTotals(permission)]);
  if (schools.length === 1) redirect(`/alumni/${encodeURIComponent(schools[0].code)}`);

  return (
    <AlumniShell
      title="Alumni"
      subtitle="Pass-outs to add and alumni records to keep up to date, school by school."
      email={email}
      showHome={!isAlumniRole(permission.role)}
      actions={
        // Restoring all alumni: edit access to every school (admins, full-access Alumni Managers).
        journeyEnabled() && reachesAllSchools(permission) && getFeatureAccess(permission, "alumni").canEdit
          ? <MassRestore scope={{ kind: "all" }} scopeLabel="all alumni" />
          : null
      }
    >
      <AlumniTotals totals={totals} />
      <HomeTabs current={view} />
      {view === "table" ? (
        <AlumniDataTable canEdit={getFeatureAccess(permission, "alumni").canEdit} />
      ) : (
        <>
          <FindAlumnus />
          {schools.length === 0 ? (
            <AlumniNotice>None of your schools have pass-outs or alumni yet.</AlumniNotice>
          ) : (
            <SchoolCards schools={schools} />
          )}
        </>
      )}
    </AlumniShell>
  );
}

/** Schools, or the "missing data" table across every school — tabs styled like the dashboard's. */
function HomeTabs({ current }: { current: HomeView }) {
  const tabs: { key: HomeView; label: string; href: string }[] = [
    { key: "schools", label: "Schools", href: "/alumni" },
    { key: "table", label: "Table · missing data", href: "/alumni?view=table" },
  ];
  return (
    <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={tab.key === current
            ? "-mb-px border-b-2 border-accent pb-2 text-sm font-bold uppercase tracking-wide text-text-primary"
            : "-mb-px pb-2 text-sm font-medium uppercase tracking-wide text-text-muted hover:text-text-primary"}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

/** The person's alumni (all of them for level 3), and how many are studying or employed now. */
function AlumniTotals({ totals }: { totals: Totals }) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard label="Alumni" value={totals.alumni} />
      <StatCard label="Studying" value={totals.studying} />
      <StatCard label="Employed" value={totals.employed} />
    </div>
  );
}

function SchoolCards({ schools }: { schools: AlumniSchool[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-text-primary">Schools</h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {schools.map((s) => (
          <li key={s.code}>
            <Card elevation="sm" className="h-full p-5 transition-shadow hover:shadow-md">
              <Link href={`/alumni/${encodeURIComponent(s.code)}`} className="block">
                <h3 className="font-semibold text-text-primary">{s.name}</h3>
                <p className="mt-0.5 font-mono text-xs text-text-muted">{s.code}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className={`rounded-full px-2 py-0.5 ${s.toAdd ? "bg-brand-coral-bg text-brand-coral" : "bg-bg-card-alt text-text-muted"}`}>
                    {s.toAdd} to add
                  </span>
                  <span className="rounded-full bg-brand-gold-bg px-2 py-0.5 text-text-primary">{s.alumni} alumni</span>
                </div>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
