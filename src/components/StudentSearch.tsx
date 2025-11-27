"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface StudentSearchResult {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  student_id: string | null;
  phone: string | null;
  school_name: string;
  school_code: string;
  grade: number | null;
}

export default function StudentSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/students/search?q=${encodeURIComponent(query)}`);
        if (response.ok) {
          const data = await response.json();
          setResults(data);
          setShowResults(true);
        }
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          placeholder="Search students by name, ID, or phone..."
          className="w-full rounded-md border border-gray-300 px-4 py-2 pl-10 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <svg
          className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {loading && (
          <div className="absolute right-3 top-2.5">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          </div>
        )}
      </div>

      {showResults && (
        <>
          {/* Backdrop to close results when clicking outside */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowResults(false)}
          />

          <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-96 overflow-y-auto">
            {results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500">
                {query.length < 2
                  ? "Type at least 2 characters to search"
                  : "No students found"}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {results.map((student) => (
                  <li key={`${student.user_id}-${student.school_code}`}>
                    <Link
                      href={`/school/${student.school_code}`}
                      onClick={() => setShowResults(false)}
                      className="block px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-900">
                          {[student.first_name, student.last_name]
                            .filter(Boolean)
                            .join(" ") || "Unknown"}
                        </span>
                        {student.grade && (
                          <span className="text-sm text-gray-500">
                            Grade {student.grade}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-gray-500">
                        {student.student_id && (
                          <span className="mr-3">ID: {student.student_id}</span>
                        )}
                        {student.phone && (
                          <span>Phone: {student.phone}</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-blue-600">
                        {student.school_name}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
