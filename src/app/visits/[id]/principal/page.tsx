"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface PrincipalMeetingData {
  syllabusStatus: string;
  examPerformance: string;
  programUpdates: string;
  potentialToppers: string;
  supportRequired: string;
  classTimingConfirmed: boolean;
  classroomAvailable: boolean;
  resourceAccess: {
    tablets: boolean;
    printers: boolean;
    smartBoards: boolean;
  };
  notes: string;
}

const emptyData: PrincipalMeetingData = {
  syllabusStatus: "",
  examPerformance: "",
  programUpdates: "",
  potentialToppers: "",
  supportRequired: "",
  classTimingConfirmed: false,
  classroomAvailable: false,
  resourceAccess: {
    tablets: false,
    printers: false,
    smartBoards: false,
  },
  notes: "",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PrincipalMeetingPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<PrincipalMeetingData>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "unsaved" | "saving">("saved");
  const [schoolName, setSchoolName] = useState<string>("");

  useEffect(() => {
    async function loadVisit() {
      try {
        const response = await fetch(`/api/pm/visits/${id}`);
        if (!response.ok) {
          throw new Error("Failed to load visit");
        }
        const result = await response.json();
        setSchoolName(result.visit.school_name || result.visit.school_code);
        if (result.visit.data?.principalMeeting) {
          setData(result.visit.data.principalMeeting);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load visit");
      } finally {
        setIsLoading(false);
      }
    }
    loadVisit();
  }, [id]);

  const handleChange = (
    field: keyof PrincipalMeetingData,
    value: string | boolean
  ) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setSaveStatus("unsaved");
  };

  const handleResourceChange = (
    resource: keyof PrincipalMeetingData["resourceAccess"],
    value: boolean
  ) => {
    setData((prev) => ({
      ...prev,
      resourceAccess: { ...prev.resourceAccess, [resource]: value },
    }));
    setSaveStatus("unsaved");
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch(`/api/pm/visits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "principalMeeting",
          data: data,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to save");
      }

      setSaveStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaveStatus("unsaved");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndContinue = async () => {
    await handleSave();
    if (!error) {
      router.push(`/visits/${id}`);
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/visits/${id}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Visit Overview
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">
          Principal Meeting
        </h1>
        <p className="text-gray-500">{schoolName}</p>
      </div>

      {/* Save Status */}
      <div className="mb-4 flex items-center justify-between">
        <span
          className={`text-sm ${
            saveStatus === "saved"
              ? "text-green-600"
              : saveStatus === "saving"
              ? "text-yellow-600"
              : "text-gray-500"
          }`}
        >
          {saveStatus === "saved"
            ? "All changes saved"
            : saveStatus === "saving"
            ? "Saving..."
            : "Unsaved changes"}
        </span>
        <button
          onClick={handleSave}
          disabled={isSaving || saveStatus === "saved"}
          className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Form */}
      <div className="bg-white shadow rounded-lg p-6 space-y-6">
        {/* Syllabus Status */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Syllabus Completion Status
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Status for each subject/class in Grades 11 and 12
          </p>
          <textarea
            rows={3}
            value={data.syllabusStatus}
            onChange={(e) => handleChange("syllabusStatus", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Physics G11: 60% complete, Chemistry G12: 80% complete..."
          />
        </div>

        {/* Exam Performance */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Exam Performance Review
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Performance in chapter tests and AIETs
          </p>
          <textarea
            rows={3}
            value={data.examPerformance}
            onChange={(e) => handleChange("examPerformance", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Average scores, trends, areas of concern..."
          />
        </div>

        {/* Program Updates */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Program Updates
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Key activities completed and upcoming events
          </p>
          <textarea
            rows={3}
            value={data.programUpdates}
            onChange={(e) => handleChange("programUpdates", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Completed: Mock test on Dec 1. Upcoming: AIET on Dec 15..."
          />
        </div>

        {/* Potential Toppers */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Potential High Performers
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Status of predicted toppers, girl students, and students needing support
          </p>
          <textarea
            rows={3}
            value={data.potentialToppers}
            onChange={(e) => handleChange("potentialToppers", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Top 5 students tracking well. 3 girls showing improvement..."
          />
        </div>

        {/* Support Required */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Support Required from School
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Timetable changes, extra classes, permissions, infrastructure
          </p>
          <textarea
            rows={3}
            value={data.supportRequired}
            onChange={(e) => handleChange("supportRequired", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Need Saturday extra classes approved. Request for additional lab time..."
          />
        </div>

        {/* Process Confirmations */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Standard Processes Enabled
          </label>
          <div className="space-y-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={data.classTimingConfirmed}
                onChange={(e) =>
                  handleChange("classTimingConfirmed", e.target.checked)
                }
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">
                Fixed class timings consistently followed
              </span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={data.classroomAvailable}
                onChange={(e) =>
                  handleChange("classroomAvailable", e.target.checked)
                }
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">
                Suitable classroom allocated without disturbances
              </span>
            </label>
          </div>
        </div>

        {/* Resource Access */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Access to Resources
          </label>
          <div className="space-y-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={data.resourceAccess.tablets}
                onChange={(e) =>
                  handleResourceChange("tablets", e.target.checked)
                }
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">
                Tablets/computers for practice and assessments
              </span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={data.resourceAccess.printers}
                onChange={(e) =>
                  handleResourceChange("printers", e.target.checked)
                }
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">
                Printers and printing support
              </span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={data.resourceAccess.smartBoards}
                onChange={(e) =>
                  handleResourceChange("smartBoards", e.target.checked)
                }
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">
                Smart boards or projectors available
              </span>
            </label>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Additional Notes
          </label>
          <textarea
            rows={3}
            value={data.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Any other observations or action items..."
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={handleSaveAndContinue}
          disabled={isSaving}
          className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save & Return to Overview"}
        </button>
        <Link
          href={`/visits/${id}`}
          className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Cancel
        </Link>
      </div>
    </main>
  );
}
