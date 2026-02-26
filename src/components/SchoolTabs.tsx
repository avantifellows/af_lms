"use client";

import { useState } from "react";
import Link from "next/link";
import { statusBadgeClass } from "@/lib/visit-actions";

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface Props {
  tabs: Tab[];
  defaultTab?: string;
}

export default function SchoolTabs({ tabs, defaultTab }: Props) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || "");

  const activeContent = tabs.find((t) => t.id === activeTab)?.content;

  return (
    <div>
      <div className="border-b-2 border-border mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm uppercase font-bold ${
                activeTab === tab.id
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary hover:border-border"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div>{activeContent}</div>
    </div>
  );
}

interface VisitHistoryProps {
  visits: {
    id: number;
    visit_date: string;
    status: string;
    inserted_at?: string | null;
    completed_at?: string | null;
  }[];
  schoolCode: string;
}

export function VisitHistorySection({ visits, schoolCode }: VisitHistoryProps) {
  if (visits.length === 0) {
    return (
      <div className="bg-bg-card-alt border border-border p-6 mb-6 text-center">
        <p className="text-text-muted uppercase tracking-wide">No visits recorded yet</p>
        <Link
          href={`/school/${schoolCode}/visit/new`}
          className="inline-flex items-center mt-4 px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent bg-accent hover:bg-accent-hover"
        >
          Start First Visit
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Visit History</h2>
        <Link
          href={`/school/${schoolCode}/visit/new`}
          className="inline-flex items-center px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent bg-accent hover:bg-accent-hover"
        >
          Start New Visit
        </Link>
      </div>
      <div className="space-y-3">
        {visits.map((visit) => (
          <div
            key={visit.id}
            className="flex justify-between items-center p-3 bg-bg-card-alt border-b border-border"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    timeZone: "Asia/Kolkata",
                  })}
                </span>
                <span
                  className={`inline-flex ${statusBadgeClass(visit.status)}`}
                >
                  {visit.status === "completed"
                    ? "Completed"
                    : "In Progress"}
                </span>
              </div>
              <div className="text-xs text-text-muted font-mono mt-1">
                {visit.inserted_at && (
                  <span>
                    Started: {new Date(visit.inserted_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })}
                  </span>
                )}
                {visit.completed_at && (
                  <span className="ml-3">
                    Completed: {new Date(visit.completed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })}
                  </span>
                )}
              </div>
            </div>
            <Link
              href={`/visits/${visit.id}`}
              className="text-sm text-accent hover:text-accent-hover font-bold uppercase"
            >
              {visit.status === "completed" ? "View" : "Continue"}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
