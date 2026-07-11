import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export interface Centre {
  id: number;
  name: string;
  school_name?: string | null;
  batch_count?: number;
}

interface CentreCardProps {
  centre: Centre;
  href: string;
  showBatchCount?: boolean;
}

export default function CentreCard({ centre, href, showBatchCount = false }: CentreCardProps) {
  return (
    <Card className="p-6">
      <Link href={href} className="block">
        <h3 className="font-semibold text-text-primary">{centre.name}</h3>
        {centre.school_name && (
          <p className="mt-1 text-sm text-text-secondary">{centre.school_name}</p>
        )}
        {showBatchCount && centre.batch_count !== undefined && (
          <div className="mt-2">
            <Badge className="py-0.5 bg-brand-gold-bg text-text-primary">
              {centre.batch_count} {centre.batch_count === 1 ? "batch" : "batches"}
            </Badge>
          </div>
        )}
      </Link>
    </Card>
  );
}
