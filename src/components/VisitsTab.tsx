"use client";

import { useState, useEffect } from "react";
import { VisitHistorySection } from "./SchoolTabs";

interface Visit {
  id: number;
  visit_date: string;
  status: string;
  inserted_at: string;
  completed_at: string | null;
}

interface Props {
  schoolCode: string;
  canEdit?: boolean;
}

export default function VisitsTab({ schoolCode, canEdit = false }: Props) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVisits() {
      try {
        const res = await fetch(`/api/pm/visits?school_code=${schoolCode}`);
        if (!res.ok) throw new Error("Failed to fetch visits");
        const data = await res.json();
        setVisits(data.visits);
      } catch (err) {
        console.error("Failed to fetch visits:", err);
        setError("Failed to load visit data");
      }
    }
    fetchVisits();
  }, [schoolCode]);

  if (error) {
    return (
      <div className="bg-danger-bg border border-danger/20 p-4 text-danger">
        {error}
      </div>
    );
  }

  if (visits === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
        <span className="ml-3 text-text-secondary">Loading visit history...</span>
      </div>
    );
  }

  return <VisitHistorySection visits={visits} schoolCode={schoolCode} canEdit={canEdit} />;
}
