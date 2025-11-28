"use client";

import { useState } from "react";
import { Grade } from "./StudentTable";

interface Student {
  group_user_id: string;
  user_id: string;
  student_pk_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  student_id: string | null;
  apaar_id: string | null;
  category: string | null;
  stream: string | null;
  gender: string | null;
  program_name: string | null;
  grade: number | null;
  grade_id: string | null;
  status: string | null;
}

interface EditStudentModalProps {
  student: Student;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  grades: Grade[];
}

const CATEGORY_OPTIONS = ["Gen", "OBC", "SC", "ST", "Gen-EWS"];
const STREAM_OPTIONS = [
  "engineering",
  "medical",
  "pcmb",
  "foundation",
  "clat",
  "ca",
  "pcb",
  "pcm",
];
const GENDER_OPTIONS = ["Male", "Female", "Other"];

function getCurrentAcademicYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  // Academic year starts in April (month 3)
  if (month >= 3) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

function formatDateForAPI(date: Date): string {
  return date.toISOString().split("T")[0];
}

const inputClassName =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const labelClassName = "block text-sm font-medium text-gray-700";

export default function EditStudentModal({
  student,
  isOpen,
  onClose,
  onSave,
  grades,
}: EditStudentModalProps) {
  const [formData, setFormData] = useState({
    first_name: student.first_name || "",
    last_name: student.last_name || "",
    phone: student.phone || "",
    gender: student.gender || "",
    date_of_birth: student.date_of_birth || "",
    category: student.category || "",
    stream: student.stream || "",
    grade_id: student.grade_id || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDropoutConfirm, setShowDropoutConfirm] = useState(false);
  const [dropoutDate, setDropoutDate] = useState(formatDateForAPI(new Date()));
  const [dropoutYear, setDropoutYear] = useState(getCurrentAcademicYear());

  const isDropout = student.status === "dropout";

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!student.student_pk_id) {
      setError("Cannot update student: missing student record ID");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/student/${student.student_pk_id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update student");
      }

      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleMarkAsDropout = async () => {
    setError("");
    setLoading(true);

    try {
      // Use student_id if available, otherwise fall back to apaar_id
      const identifier = student.student_id
        ? { student_id: student.student_id }
        : { apaar_id: student.apaar_id };

      const response = await fetch("/api/student/dropout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...identifier,
          start_date: dropoutDate,
          academic_year: dropoutYear,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to mark student as dropout");
      }

      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setShowDropoutConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black bg-opacity-30"
          onClick={onClose}
        />
        <div className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              Edit Student
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>First Name</label>
                <input
                  type="text"
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={labelClassName}>Last Name</label>
                <input
                  type="text"
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Student ID</label>
                <input
                  type="text"
                  value={student.student_id || "—"}
                  disabled
                  className={`${inputClassName} bg-gray-100 text-gray-500 cursor-not-allowed`}
                />
              </div>
              <div>
                <label className={labelClassName}>APAAR ID</label>
                <input
                  type="text"
                  value={student.apaar_id || "—"}
                  disabled
                  className={`${inputClassName} bg-gray-100 text-gray-500 cursor-not-allowed`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Grade</label>
                <select
                  name="grade_id"
                  value={formData.grade_id}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {grades.map((grade) => (
                    <option key={grade.id} value={grade.id}>
                      Grade {grade.number}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClassName}>Date of Birth</label>
                <input
                  type="date"
                  name="date_of_birth"
                  value={formData.date_of_birth}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Phone</label>
                <input
                  type="text"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={labelClassName}>Gender</label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Category</label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClassName}>Stream</label>
                <select
                  name="stream"
                  value={formData.stream}
                  onChange={handleChange}
                  className={inputClassName}
                >
                  <option value="">Select...</option>
                  {STREAM_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!isDropout && !showDropoutConfirm && (
              <div className="border-t pt-4 mt-4">
                <button
                  type="button"
                  onClick={() => setShowDropoutConfirm(true)}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Mark as Dropout...
                </button>
              </div>
            )}

            {isDropout && (
              <div className="border-t pt-4 mt-4">
                <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-800">
                  Student is marked as Dropout
                </span>
              </div>
            )}

            {showDropoutConfirm && (
              <div className="border-t pt-4 mt-4 bg-red-50 -mx-6 px-6 pb-4 rounded-b-lg">
                <h3 className="text-sm font-semibold text-red-800 mb-3">
                  Confirm Dropout
                </h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelClassName}>Dropout Date</label>
                    <input
                      type="date"
                      value={dropoutDate}
                      onChange={(e) => setDropoutDate(e.target.value)}
                      className={inputClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Academic Year</label>
                    <input
                      type="text"
                      value={dropoutYear}
                      onChange={(e) => setDropoutYear(e.target.value)}
                      placeholder="e.g., 2025-2026"
                      className={inputClassName}
                    />
                  </div>
                </div>
                <p className="text-sm text-red-700 mb-3">
                  Are you sure you want to mark this student as dropout? This
                  action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDropoutConfirm(false)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleMarkAsDropout}
                    disabled={loading}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:bg-gray-300"
                  >
                    {loading ? "Processing..." : "Confirm Dropout"}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
