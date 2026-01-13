"use client";

import { useState } from "react";
import Link from "next/link";

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
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
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
  }[];
  schoolCode: string;
}

export function VisitHistorySection({ visits, schoolCode }: VisitHistoryProps) {
  if (visits.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6 text-center">
        <p className="text-gray-500">No visits recorded yet</p>
        <Link
          href={`/school/${schoolCode}/visit/new`}
          className="inline-flex items-center mt-4 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
        >
          Start First Visit
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Visit History</h2>
        <Link
          href={`/school/${schoolCode}/visit/new`}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
        >
          Start New Visit
        </Link>
      </div>
      <div className="space-y-3">
        {visits.map((visit) => (
          <div
            key={visit.id}
            className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
          >
            <div>
              <span className="font-medium">
                {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  timeZone: "Asia/Kolkata",
                })}
              </span>
              <span
                className={`ml-3 inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  visit.status === "completed"
                    ? "bg-green-100 text-green-800"
                    : "bg-yellow-100 text-yellow-800"
                }`}
              >
                {visit.status === "completed" ? "Completed" : "In Progress"}
              </span>
            </div>
            <Link
              href={`/visits/${visit.id}`}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {visit.status === "completed" ? "View" : "Continue"}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
