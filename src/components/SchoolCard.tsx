import Link from "next/link";

export interface School {
  id: string;
  code: string;
  name: string;
  district: string;
  state: string;
  region?: string | null;
  student_count?: number;
}

interface SchoolCardProps {
  school: School;
  href: string;
  showStudentCount?: boolean;
  showRegion?: boolean;
  actions?: React.ReactNode;
}

export default function SchoolCard({
  school,
  href,
  showStudentCount = false,
  showRegion = false,
  actions,
}: SchoolCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
      <Link href={href} className="block">
        <h3 className="font-semibold text-gray-900">{school.name}</h3>
        <p className="mt-1 text-sm text-gray-500">
          {school.district}, {school.state}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {showRegion && school.region && `Region: ${school.region} | `}
          Code: {school.code}
        </p>
        {showStudentCount && school.student_count !== undefined && (
          <p className="mt-2 text-sm text-gray-600">
            {school.student_count} students
          </p>
        )}
      </Link>
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  );
}
