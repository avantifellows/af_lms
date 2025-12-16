import Link from "next/link";

export interface GradeCount {
  grade: number;
  count: number;
}

export interface School {
  id: string;
  code: string;
  name: string;
  district: string;
  state: string;
  region?: string | null;
  student_count?: number;
  nvs_student_count?: number;
  grade_counts?: GradeCount[];
}

interface SchoolCardProps {
  school: School;
  href: string;
  showStudentCount?: boolean;
  showNVSCount?: boolean;
  showGradeBreakdown?: boolean;
  showRegion?: boolean;
  actions?: React.ReactNode;
}

export default function SchoolCard({
  school,
  href,
  showStudentCount = false,
  showNVSCount = false,
  showGradeBreakdown = false,
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
        {showNVSCount && school.nvs_student_count !== undefined && (
          <p className="mt-2 text-sm font-medium text-blue-600">
            {school.nvs_student_count} NVS students
          </p>
        )}
        {showGradeBreakdown && school.grade_counts && school.grade_counts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {school.grade_counts.map((gc) => (
              <span
                key={gc.grade}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
              >
                G{gc.grade}: {gc.count}
              </span>
            ))}
          </div>
        )}
      </Link>
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  );
}
