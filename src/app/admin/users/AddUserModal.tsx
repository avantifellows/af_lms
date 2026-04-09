"use client";

import { useState, useEffect } from "react";
import { Modal, Input, Select, Button } from "@/components/ui";

interface UserPermission {
  id: number;
  email: string;
  level: number;
  role: string;
  school_codes: string[] | null;
  regions: string[] | null;
  program_ids: number[] | null;
  read_only: boolean;
  full_name: string | null;
}

// Program definitions
const PROGRAMS = [
  { id: 1, name: "JNV CoE", description: "Center of Excellence program" },
  { id: 2, name: "JNV Nodal", description: "Nodal schools program" },
  { id: 64, name: "JNV NVS", description: "NVS schools (limited features)" },
];

interface AddUserModalProps {
  user: UserPermission | null;
  regions: string[];
  onClose: () => void;
  onSave: () => void;
}

interface School {
  code: string;
  name: string;
  region: string;
}

const labelClassName = "block text-sm font-medium text-gray-700";

export default function AddUserModal({ user, regions, onClose, onSave }: AddUserModalProps) {
  const [email, setEmail] = useState(user?.email || "");
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [level, setLevel] = useState(user?.level || 1);
  const [role, setRole] = useState(user?.role || "teacher");
  const [selectedRegions, setSelectedRegions] = useState<string[]>(user?.regions || []);
  const [selectedSchools, setSelectedSchools] = useState<string[]>(user?.school_codes || []);
  const [selectedPrograms, setSelectedPrograms] = useState<number[]>(user?.program_ids || []);
  const [readOnly, setReadOnly] = useState(user?.read_only || false);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [searchResults, setSearchResults] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Check if only NVS is selected (for warning display)
  const isNVSOnly = selectedPrograms.length === 1 && selectedPrograms.includes(64);

  const toggleProgram = (programId: number) => {
    setSelectedPrograms((prev) =>
      prev.includes(programId)
        ? prev.filter((id) => id !== programId)
        : [...prev, programId]
    );
  };

  const isEditing = !!user;

  // Search schools
  useEffect(() => {
    if (level !== 1 || schoolSearch.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      const response = await fetch(`/api/admin/schools?q=${encodeURIComponent(schoolSearch)}`);
      if (response.ok) {
        const schools = await response.json();
        setSearchResults(schools);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [schoolSearch, level]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const isAdminRole = role === "admin";

      // Validate program selection (not needed for admins)
      if (!isAdminRole && selectedPrograms.length === 0) {
        throw new Error("At least one program must be selected");
      }

      const body: Record<string, unknown> = {
        level: isAdminRole ? 3 : level,
        role,
        read_only: isAdminRole ? false : readOnly,
        program_ids: isAdminRole ? PROGRAMS.map((p) => p.id) : selectedPrograms,
        full_name: fullName.trim() || null,
      };

      if (!isEditing) {
        body.email = email;
      }

      if (isAdminRole) {
        body.school_codes = null;
        body.regions = null;
      } else if (level === 2) {
        body.regions = selectedRegions;
        body.school_codes = null;
      } else if (level === 1) {
        body.school_codes = selectedSchools;
        body.regions = null;
      } else {
        body.school_codes = null;
        body.regions = null;
      }

      const url = isEditing ? `/api/admin/users/${user.id}` : "/api/admin/users";
      const method = isEditing ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save user");
      }

      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const toggleRegion = (region: string) => {
    setSelectedRegions((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
    );
  };

  const addSchool = (code: string) => {
    if (!selectedSchools.includes(code)) {
      setSelectedSchools([...selectedSchools, code]);
    }
    setSchoolSearch("");
    setSearchResults([]);
  };

  const removeSchool = (code: string) => {
    setSelectedSchools(selectedSchools.filter((c) => c !== code));
  };

  return (
    <Modal open={true} onClose={onClose} className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {isEditing ? "Edit User" : "Add User"}
            </h2>
            <Button variant="icon" onClick={onClose}>
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>

          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClassName}>Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isEditing}
                required
                className={isEditing ? "bg-gray-100 mt-1" : "mt-1"}
              />
            </div>

            <div>
              <label className={labelClassName}>Full Name</label>
              <Input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Priya Sharma"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-gray-500">
                Display name shown in teacher dropdowns and reports
              </p>
            </div>

            <div>
              <label className={labelClassName}>Role</label>
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 w-full"
              >
                <option value="teacher">Teacher - Student management view</option>
                <option value="program_manager">Program Manager - School visits + student management</option>
                <option value="program_admin">Program Admin - Scoped oversight with read-only visits</option>
                <option value="admin">Admin - Full access + user management</option>
              </Select>
              <p className="mt-1 text-xs text-gray-500">
                {role === "program_manager" && "Program Managers can conduct school visits and view their assigned schools"}
                {role === "program_admin" && "Program Admins can oversee scoped schools; visit workflows are read-only"}
                {role === "teacher" && "Teachers can view and manage students in their assigned schools"}
                {role === "admin" && "Admins have full access to all features, all schools, and all programs"}
              </p>
            </div>

            {role === "admin" ? (
              <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
                Admins automatically get access to all schools, all programs, and full edit permissions.
              </div>
            ) : (
            <>
            <div>
              <label className={labelClassName}>School Access</label>
              <Select
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
                className="mt-1 w-full"
              >
                <option value={3}>All Schools - Access to all JNV schools</option>
                <option value={2}>Region - Access to schools in specific regions</option>
                <option value={1}>School - Access to specific schools</option>
              </Select>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="readOnly"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                className="h-4 w-4 text-accent rounded border-gray-300"
              />
              <label htmlFor="readOnly" className="ml-2 text-sm text-gray-800">
                Read-only access (cannot edit students)
              </label>
            </div>

            <div>
              <label className={labelClassName}>Assign Programs</label>
              <p className="text-xs text-gray-500 mb-2">
                Select which programs this user can access. At least one program is required.
              </p>
              <div className="mt-2 space-y-2 border rounded-md p-3">
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
              {isNVSOnly && (
                <p className="mt-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                  Note: NVS-only users have limited access (students and analytics only, no visits/curriculum/mentorship).
                </p>
              )}
              {selectedPrograms.length === 0 && (
                <p className="mt-2 text-xs text-red-600">
                  At least one program must be selected.
                </p>
              )}
            </div>

            {level === 2 && (
              <div>
                <label className={labelClassName}>Select Regions</label>
                <div className="mt-2 max-h-48 overflow-y-auto border rounded-md p-2">
                  {regions.map((region) => (
                    <label key={region} className="flex items-center p-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRegions.includes(region)}
                        onChange={() => toggleRegion(region)}
                        className="h-4 w-4 text-accent rounded border-gray-300"
                      />
                      <span className="ml-2 text-sm text-gray-800">{region}</span>
                    </label>
                  ))}
                </div>
                {selectedRegions.length > 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    Selected: {selectedRegions.join(", ")}
                  </p>
                )}
              </div>
            )}

            {level === 1 && (
              <div>
                <label className={labelClassName}>Assign Schools</label>
                <Input
                  type="text"
                  value={schoolSearch}
                  onChange={(e) => setSchoolSearch(e.target.value)}
                  placeholder="Search schools by name or code..."
                  className="mt-1"
                />
                {searchResults.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto border rounded-md bg-white shadow-lg">
                    {searchResults.map((school) => (
                      <button
                        key={school.code}
                        type="button"
                        onClick={() => addSchool(school.code)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
                      >
                        <span className="font-medium text-gray-900">{school.name}</span>
                        <span className="text-gray-600 ml-2">({school.code})</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedSchools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedSchools.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center rounded-full bg-hover-bg px-3 py-1 text-sm text-accent-hover"
                      >
                        {code}
                        <button
                          type="button"
                          onClick={() => removeSchool(code)}
                          className="ml-2 text-accent hover:text-accent-hover"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            </>
            )}



            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={loading}
              >
                {loading ? "Saving..." : isEditing ? "Save Changes" : "Add User"}
              </Button>
            </div>
          </form>
    </Modal>
  );
}
