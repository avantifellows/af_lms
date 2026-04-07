interface StatCardProps {
  label: string;
  value: string | number;
  size?: "sm" | "md" | "lg";
}

export default function StatCard({ label, value, size = "md" }: StatCardProps) {
  const valueSize = {
    sm: "text-lg",
    md: "text-2xl sm:text-3xl",
    lg: "text-3xl md:text-4xl",
  }[size];

  return (
    <div className="bg-bg-card border border-border p-3 sm:p-4 md:p-5 transition-colors">
      <span className="text-xs sm:text-sm uppercase tracking-wider block text-text-muted">
        {label}
      </span>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`${valueSize} font-bold font-mono text-text-primary`}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
      </div>
    </div>
  );
}
