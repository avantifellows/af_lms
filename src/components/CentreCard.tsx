import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { Centre } from "@/lib/dashboard-groupings";

interface CentreCardProps {
  centre: Centre;
  showRegion?: boolean;
  actions?: React.ReactNode;
}

/**
 * A single "Physical Centre" on the dashboard's Centres tab. Clicks through to
 * the centre roster page; mirrors SchoolCard (student count, grade breakdown,
 * optional actions like Start Visit).
 */
export default function CentreCard({ centre, showRegion = false, actions }: CentreCardProps) {
  return (
    <Card className="p-6">
      <Link href={`/centre/${centre.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-text-primary">{centre.name}</h3>
          {centre.program_name && (
            <Badge className="shrink-0 py-0.5 bg-brand-gold-bg text-text-primary">
              {centre.program_name}
            </Badge>
          )}
        </div>
        {centre.school_name && (
          <p className="mt-1 text-sm text-text-secondary">{centre.school_name}</p>
        )}
        {showRegion && centre.region && (
          <p className="mt-1 text-xs text-text-muted">Region: {centre.region}</p>
        )}
        <p className="mt-2 text-sm font-medium text-brand-coral">
          {centre.student_count} students
        </p>
        {centre.grade_counts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {centre.grade_counts.map((gc) => (
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
