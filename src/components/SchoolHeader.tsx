import Link from "next/link";
import StatCard from "./StatCard";

interface SchoolInfo {
  name: string;
  code: string;
  udise_code?: string | null;
  district: string;
  state: string;
  region?: string | null;
}

interface Stat {
  label: string;
  value: string | number;
}

interface SchoolHeaderProps {
  school: SchoolInfo;
  stats?: Stat[];
  backHref: string;
  actions?: React.ReactNode;
}

export default function SchoolHeader({
  school,
  stats,
  backHref,
  actions,
}: SchoolHeaderProps) {
  return (
    <>
      {/* Back link */}
      <div className="mb-4">
        <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back
        </Link>
      </div>

      {/* School Header Card */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{school.name}</h1>
            <p className="mt-1 text-gray-500">
              {school.district}, {school.state}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              Code: {school.code}
              {school.udise_code && ` | UDISE: ${school.udise_code}`}
              {school.region && ` | Region: ${school.region}`}
            </p>
          </div>
          {actions}
        </div>

        {/* Stats */}
        {stats && stats.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stats.map((stat) => (
              <StatCard key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
