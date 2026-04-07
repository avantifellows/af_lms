"use client";

import { useState } from "react";
import { Modal, Input, Select, Button, Card } from "@/components/ui";

interface School {
  id: number;
  code: string;
  name: string;
  region: string;
  program_ids: number[] | null;
}

interface SchoolListProps {
  initialSchools: School[];
}

const PROGRAM_LABELS: Record<number, string> = {
  1: "CoE",
  2: "Nodal",
  64: "NVS",
};

const PROGRAM_COLORS: Record<number, string> = {
  1: "bg-purple-100 text-purple-800",
  2: "bg-hover-bg text-accent-hover",
  64: "bg-green-100 text-green-800",
};

const PROGRAMS = [
  { id: 1, name: "CoE", description: "Center of Excellence" },
  { id: 2, name: "Nodal", description: "Nodal schools" },
  { id: 64, name: "NVS", description: "NVS program" },
];

export default function SchoolList({ initialSchools }: SchoolListProps) {
  const [schools, setSchools] = useState(initialSchools);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [selectedPrograms, setSelectedPrograms] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState<number | "all">("all");

  const openEditModal = (school: School) => {
    setEditingSchool(school);
    setSelectedPrograms(school.program_ids || []);
    setError("");
  };

  const closeModal = () => {
    setEditingSchool(null);
    setSelectedPrograms([]);
    setError("");
  };

  const toggleProgram = (programId: number) => {
    setSelectedPrograms((prev) =>
      prev.includes(programId)
        ? prev.filter((id) => id !== programId)
        : [...prev, programId]
    );
  };

  const handleSave = async () => {
    if (!editingSchool) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/schools/${editingSchool.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_ids: selectedPrograms }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save");
      }

      // Update local state
      setSchools((prev) =>
        prev.map((s) =>
          s.code === editingSchool.code
            ? { ...s, program_ids: selectedPrograms }
            : s
        )
      );

      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  // Filter schools
  const filteredSchools = schools.filter((school) => {
    const matchesSearch =
      search === "" ||
      school.name.toLowerCase().includes(search.toLowerCase()) ||
      school.code.includes(search);

    const matchesProgram =
      programFilter === "all" ||
      (school.program_ids && school.program_ids.includes(programFilter));

    return matchesSearch && matchesProgram;
  });

  // Count schools by program
  const programCounts = {
    coe: schools.filter((s) => s.program_ids?.includes(1)).length,
    nodal: schools.filter((s) => s.program_ids?.includes(2)).length,
    nvs: schools.filter((s) => s.program_ids?.includes(64)).length,
    none: schools.filter((s) => !s.program_ids || s.program_ids.length === 0).length,
  };

  return (
    <>
      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card elevation="sm" className="p-4">
          <div className="text-2xl font-bold text-purple-600">{programCounts.coe}</div>
          <div className="text-sm text-gray-500">CoE Schools</div>
        </Card>
        <Card elevation="sm" className="p-4">
          <div className="text-2xl font-bold text-accent">{programCounts.nodal}</div>
          <div className="text-sm text-gray-500">Nodal Schools</div>
        </Card>
        <Card elevation="sm" className="p-4">
          <div className="text-2xl font-bold text-green-600">{programCounts.nvs}</div>
          <div className="text-sm text-gray-500">NVS Schools</div>
        </Card>
        <Card elevation="sm" className="p-4">
          <div className="text-2xl font-bold text-gray-600">{programCounts.none}</div>
          <div className="text-sm text-gray-500">No Programs</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <Input
            type="text"
            placeholder="Search by name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">All Programs</option>
            <option value="1">CoE only</option>
            <option value="2">Nodal only</option>
            <option value="64">NVS only</option>
          </Select>
        </div>
        <div className="text-sm text-gray-500">
          Showing {filteredSchools.length} of {schools.length} schools
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                School
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Code
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Region
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Programs
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredSchools.map((school) => (
              <tr key={school.code} className="hover:bg-gray-50">
                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                  {school.name}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  {school.code}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  {school.region || "-"}
                </td>
                <td className="px-3 py-4 text-sm">
                  {school.program_ids && school.program_ids.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {school.program_ids.map((id) => (
                        <span
                          key={id}
                          className={`inline-flex px-2 py-0.5 text-xs rounded-full ${PROGRAM_COLORS[id] || "bg-gray-100 text-gray-800"}`}
                        >
                          {PROGRAM_LABELS[id] || `Program ${id}`}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-400 text-xs">No programs</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditModal(school)}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editingSchool && (
        <Modal open={true} onClose={closeModal} className="max-w-md p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  Edit Programs
                </h2>
                <Button variant="icon" onClick={closeModal}>
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">{editingSchool.name}</span>
                  <span className="text-gray-400 ml-2">({editingSchool.code})</span>
                </p>
              </div>

              {error && (
                <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
              )}

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assign Programs
                </label>
                <div className="space-y-2 border rounded-md p-3">
                  {PROGRAMS.map((program) => (
                    <label
                      key={program.id}
                      className="flex items-start p-2 hover:bg-gray-50 cursor-pointer rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPrograms.includes(program.id)}
                        onChange={() => toggleProgram(program.id)}
                        className="h-4 w-4 text-accent rounded border-gray-300 mt-0.5"
                      />
                      <div className="ml-3">
                        <span className="text-sm font-medium text-gray-900">
                          {program.name}
                        </span>
                        <p className="text-xs text-gray-500">{program.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={closeModal}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
        </Modal>
      )}
    </>
  );
}
