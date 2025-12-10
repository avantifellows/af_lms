"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { use } from "react";

interface PageProps {
  params: Promise<{ code: string }>;
}

export default function NewVisitPage({ params }: PageProps) {
  const { code } = use(params);
  const router = useRouter();
  const [visitDate, setVisitDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/pm/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: code,
          visit_date: visitDate,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create visit");
      }

      const data = await response.json();
      router.push(`/pm/visits/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link
          href={`/pm/school/${code}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to School
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Start New School Visit
        </h1>

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label
              htmlFor="school_code"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              School Code
            </label>
            <input
              type="text"
              id="school_code"
              value={code}
              disabled
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-600"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="visit_date"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Visit Date
            </label>
            <input
              type="date"
              id="visit_date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating..." : "Start Visit"}
            </button>
            <Link
              href={`/pm/school/${code}`}
              className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Visit Workflow</h3>
        <p className="text-sm text-blue-800 mb-2">
          Once you start the visit, you&apos;ll be guided through the following sections:
        </p>
        <ol className="text-sm text-blue-800 list-decimal list-inside space-y-1">
          <li>Principal Meeting & Core Operations Review</li>
          <li>Leadership Meetings (VP & CBSE Teachers)</li>
          <li>Classroom Observations</li>
          <li>Student Discussions (Group & Individual)</li>
          <li>Staff Meetings (Individual & Team)</li>
          <li>Feedback & Issue Log</li>
        </ol>
      </div>
    </main>
  );
}
