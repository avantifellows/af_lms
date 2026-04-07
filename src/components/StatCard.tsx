import { Card } from "@/components/ui/Card";

interface StatCardProps {
  label: string;
  value: string | number;
  size?: "sm" | "md" | "lg";
  /** Brand color for left border accent — e.g. "brand-coral", "brand-blue", "brand-amber" */
  color?: string;
}

export default function StatCard({ label, value, size = "md", color }: StatCardProps) {
  const valueSize = {
    sm: "text-lg",
    md: "text-2xl sm:text-3xl",
    lg: "text-3xl md:text-4xl",
  }[size];

  const borderClass = color ? `border-l-4 border-l-${color}` : "";
  const labelColor = color ? `text-${color}` : "text-text-muted";

  return (
    <Card elevation="sm" className={`p-3 sm:p-4 md:p-5 ${borderClass}`}>
      <span className={`text-xs sm:text-sm uppercase tracking-wider block ${labelColor}`}>
        {label}
      </span>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`${valueSize} font-bold font-mono text-text-primary`}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
      </div>
    </Card>
  );
}
