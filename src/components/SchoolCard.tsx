import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

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
  grade_counts?: GradeCount[];
}

interface SchoolCardProps {
  school: School;
  href: string;
  showStudentCount?: boolean;
  showGradeBreakdown?: boolean;
  showRegion?: boolean;
  actions?: React.ReactNode;
}

export default function SchoolCard({
  school,
  href,
  showStudentCount = false,
  showGradeBreakdown = false,
  showRegion = false,
  actions,
}: SchoolCardProps) {
  return (
    <Card className="p-6">
      <Link href={href} className="block">
        <h3 className="font-semibold text-text-primary">{school.name}</h3>
        <p className="mt-1 text-sm text-text-secondary">
          {school.district}, {school.state}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {showRegion && school.region && `Region: ${school.region} | `}
          Code: {school.code}
        </p>
        {showStudentCount && school.student_count !== undefined && (
          <p className="mt-2 text-sm text-text-secondary">
            {school.student_count} students
          </p>
        )}
        {showStudentCount && school.student_count !== undefined && (
          <p className="mt-2 text-sm font-medium text-brand-coral">
            {school.student_count} students
          </p>
        )}
        {showGradeBreakdown && school.grade_counts && school.grade_counts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {school.grade_counts.map((gc) => (
              <Badge key={gc.grade} className="py-0.5 bg-brand-gold-bg text-text-primary">
                G{gc.grade}: {gc.count}
              </Badge>
            ))}
          </div>
        )}
      </Link>
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </Card>
  );
}
