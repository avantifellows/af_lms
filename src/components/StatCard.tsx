import { Card } from "@/components/ui/Card";

interface StatCardProps {
  label: string;
  value: string | number;
  size?: "sm" | "md" | "lg";
}

export default function StatCard({ label, value, size = "md" }: StatCardProps) {
  const valueSize = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl",
  }[size];

  return (
    <Card elevation="sm" className="bg-gray-50 p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`${valueSize} font-semibold text-gray-900`}>{value}</div>
    </Card>
  );
}
