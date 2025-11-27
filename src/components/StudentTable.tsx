"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EditStudentModal from "./EditStudentModal";

interface Student {
  group_user_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  student_id: string | null;
  apaar_id: string | null;
  category: string | null;
  stream: string | null;
  gender: string | null;
  program_name: string | null;
  grade: number | null;
}

interface StudentTableProps {
  students: Student[];
  canEdit?: boolean;
}

export default function StudentTable({ students, canEdit = true }: StudentTableProps) {
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
  const router = useRouter();

  // Get unique grades from students
  const grades = [...new Set(students.map(s => s.grade).filter((g): g is number => g !== null))].sort((a, b) => a - b);

  // Filter students by selected grade
  const filteredStudents = selectedGrade === "all"
    ? students
    : students.filter(s => s.grade === parseInt(selectedGrade));

  const handleSave = () => {
    router.refresh();
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-4">
        <label htmlFor="gradeFilter" className="text-sm font-medium text-gray-700">
          Filter by Grade:
        </label>
        <select
          id="gradeFilter"
          value={selectedGrade}
          onChange={(e) => setSelectedGrade(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All Grades ({students.length})</option>
          {grades.map((grade) => (
            <option key={grade} value={grade}>
              Grade {grade} ({students.filter(s => s.grade === grade).length})
            </option>
          ))}
        </select>
        {selectedGrade !== "all" && (
          <span className="text-sm text-gray-500">
            Showing {filteredStudents.length} of {students.length} students
          </span>
        )}
      </div>

      <div className="overflow-hidden bg-white shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                Name
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Grade
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Student ID
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                APAAR ID
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Phone
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Gender
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Category
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Stream
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Program
              </th>
              {canEdit && (
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 10 : 9} className="py-8 text-center text-sm text-gray-500">
                  {students.length === 0 ? "No students enrolled in this school" : "No students match the selected filter"}
                </td>
              </tr>
            ) : (
              filteredStudents.map((student) => (
                <tr key={student.group_user_id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                    {[student.first_name, student.last_name]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {student.grade || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {student.student_id || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {student.apaar_id || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {student.phone || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {student.gender || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    <span
                      className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                        student.category === "Gen"
                          ? "bg-green-100 text-green-800"
                          : student.category === "OBC"
                          ? "bg-blue-100 text-blue-800"
                          : student.category === "SC"
                          ? "bg-purple-100 text-purple-800"
                          : student.category === "ST"
                          ? "bg-orange-100 text-orange-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {student.category || "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 capitalize">
                    {student.stream || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {student.program_name || "—"}
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      <button
                        onClick={() => setEditingStudent(student)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          isOpen={!!editingStudent}
          onClose={() => setEditingStudent(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
}
