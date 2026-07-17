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
  /**
   * Code → display name for every JNV school. Used to render chips for
   * pre-existing school_codes when editing a user (the search-results path
   * already knows the name; this fills the gap for codes that came in from
   * the user_permission row). Codes missing from the map fall back to the
   * raw code (e.g. a school that's since been deleted).
   */
  schoolCodeToName: Record<string, string>;
}

interface School {
  code: string;
  name: string;
  region: string;
}

const labelClassName = "block text-sm font-medium text-gray-700";
const ROLE_DESCRIPTIONS: Record<string, string> = {
  program_manager: "Program Managers can conduct school visits and view their assigned schools",
  program_admin: "Program Admins can oversee scoped schools and manage their own school visits",
  teacher: "Teachers can view and manage students in their assigned schools",
  holistic_mentorship_admin: "Holistic Mentorship Admins can manage Holistic Mentorship for Program 1",
  admin: "Admins have full access to all features, all schools, and all programs",
};

type UserFormValues = {
  email: string;
  fullName: string;
  level: number;
  role: string;
  selectedRegions: string[];
  selectedSchools: string[];
  selectedPrograms: number[];
  readOnly: boolean;
};

function initialUserFormValues(user: UserPermission | null): UserFormValues {
  if (!user) {
    return {
      email: "",
      fullName: "",
      level: 1,
      role: "teacher",
      selectedRegions: [],
      selectedSchools: [],
      selectedPrograms: [],
      readOnly: false,
    };
  }
  return {
    email: user.email,
    fullName: user.full_name ?? "",
    level: user.level,
    role: user.role,
    selectedRegions: user.regions ?? [],
    selectedSchools: user.school_codes ?? [],
    selectedPrograms: user.program_ids ?? [],
    readOnly: user.read_only,
  };
}

function hasGlobalSchoolAccess(role: string) {
  return role === "admin" || role === "holistic_mentorship_admin";
}

function toggledSelection<T>(selection: T[], value: T) {
  return selection.includes(value) ? selection.filter((item) => item !== value) : [...selection, value];
}

function programIdsFor(role: string, selectedPrograms: number[]) {
  if (role === "admin") return PROGRAMS.map((program) => program.id);
  if (role === "holistic_mentorship_admin") return [1];
  return selectedPrograms;
}

function schoolScopeFor(values: UserFormValues) {
  if (hasGlobalSchoolAccess(values.role)) return { school_codes: null, regions: null };
  if (values.level === 2) return { school_codes: null, regions: values.selectedRegions };
  if (values.level === 1) return { school_codes: values.selectedSchools, regions: null };
  return { school_codes: null, regions: null };
}

function buildUserBody(values: UserFormValues, user: UserPermission | null) {
  const body: Record<string, unknown> = {
    level: hasGlobalSchoolAccess(values.role) ? 3 : values.level,
    role: values.role,
    read_only: values.role === "admin" ? false : values.readOnly,
    program_ids: programIdsFor(values.role, values.selectedPrograms),
    full_name: values.fullName.trim() || null,
  };
  if (!user) body.email = values.email;
  Object.assign(body, schoolScopeFor(values));
  return body;
}

async function saveUser(values: UserFormValues, user: UserPermission | null) {
  if (!hasGlobalSchoolAccess(values.role) && values.selectedPrograms.length === 0) {
    throw new Error("At least one program must be selected");
  }
  const response = await fetch(user ? `/api/admin/users/${user.id}` : "/api/admin/users", {
    method: user ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildUserBody(values, user)),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Failed to save user");
  }
}

export default function AddUserModal({ user, regions, schoolCodeToName, onClose, onSave }: AddUserModalProps) {
  const initial = initialUserFormValues(user);
  const [email, setEmail] = useState(initial.email);
  const [fullName, setFullName] = useState(initial.fullName);
  const [level, setLevel] = useState(initial.level);
  const [role, setRole] = useState(initial.role);
  const [selectedRegions, setSelectedRegions] = useState(initial.selectedRegions);
  const [selectedSchools, setSelectedSchools] = useState(initial.selectedSchools);
  const [selectedPrograms, setSelectedPrograms] = useState(initial.selectedPrograms);
  const [readOnly, setReadOnly] = useState(initial.readOnly);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [searchResults, setSearchResults] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleProgram = (programId: number) => {
    setSelectedPrograms((current) => toggledSelection(current, programId));
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
      await saveUser({
        email,
        fullName,
        level,
        role,
        selectedRegions,
        selectedSchools,
        selectedPrograms,
        readOnly,
      }, user);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const toggleRegion = (region: string) => {
    setSelectedRegions((current) => toggledSelection(current, region));
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
      <UserModalHeader isEditing={isEditing} onClose={onClose} />
      {error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <IdentityFields
          email={email}
          fullName={fullName}
          isEditing={isEditing}
          onEmailChange={setEmail}
          onFullNameChange={setFullName}
        />
        <RoleField role={role} onChange={setRole} />
        <AccessFields
          role={role}
          level={level}
          readOnly={readOnly}
          regions={regions}
          selectedRegions={selectedRegions}
          selectedSchools={selectedSchools}
          selectedPrograms={selectedPrograms}
          schoolSearch={schoolSearch}
          searchResults={searchResults}
          schoolCodeToName={schoolCodeToName}
          onLevelChange={setLevel}
          onReadOnlyChange={setReadOnly}
          onToggleProgram={toggleProgram}
          onToggleRegion={toggleRegion}
          onSchoolSearchChange={setSchoolSearch}
          onAddSchool={addSchool}
          onRemoveSchool={removeSchool}
        />
        <UserFormActions isEditing={isEditing} loading={loading} onClose={onClose} />
      </form>
    </Modal>
  );
}

function UserModalHeader({ isEditing, onClose }: { isEditing: boolean; onClose: () => void }) {
  return <div className="mb-4 flex items-center justify-between">
    <h2 className="text-xl font-semibold text-gray-900">{isEditing ? "Edit User" : "Add User"}</h2>
    <Button variant="icon" onClick={onClose}>
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </Button>
  </div>;
}

function IdentityFields({
  email,
  fullName,
  isEditing,
  onEmailChange,
  onFullNameChange,
}: {
  email: string;
  fullName: string;
  isEditing: boolean;
  onEmailChange: (value: string) => void;
  onFullNameChange: (value: string) => void;
}) {
  return <>
    <div>
      <label className={labelClassName}>Email</label>
      <Input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} disabled={isEditing}
        required className={isEditing ? "bg-gray-100 mt-1" : "mt-1"} />
    </div>
    <div>
      <label className={labelClassName}>Full Name</label>
      <Input type="text" value={fullName} onChange={(event) => onFullNameChange(event.target.value)}
        placeholder="e.g. Priya Sharma" className="mt-1" />
      <p className="mt-1 text-xs text-gray-500">Display name shown in teacher dropdowns and reports</p>
    </div>
  </>;
}

function RoleField({ role, onChange }: { role: string; onChange: (role: string) => void }) {
  return <div>
    <label className={labelClassName}>Role</label>
    <Select value={role} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full">
      <option value="teacher">Teacher - Student management view</option>
      <option value="program_manager">Program Manager - School visits + student management</option>
      <option value="program_admin">Program Admin - Scoped oversight + own school visits</option>
      <option value="holistic_mentorship_admin">Holistic Mentorship Admin - Program 1 mentorship</option>
      <option value="admin">Admin - Full access + user management</option>
    </Select>
    <p className="mt-1 text-xs text-gray-500">{ROLE_DESCRIPTIONS[role]}</p>
  </div>;
}

type AccessFieldsProps = {
  role: string;
  level: number;
  readOnly: boolean;
  regions: string[];
  selectedRegions: string[];
  selectedSchools: string[];
  selectedPrograms: number[];
  schoolSearch: string;
  searchResults: School[];
  schoolCodeToName: Record<string, string>;
  onLevelChange: (level: number) => void;
  onReadOnlyChange: (readOnly: boolean) => void;
  onToggleProgram: (programId: number) => void;
  onToggleRegion: (region: string) => void;
  onSchoolSearchChange: (search: string) => void;
  onAddSchool: (code: string) => void;
  onRemoveSchool: (code: string) => void;
};

function AccessFields(props: AccessFieldsProps) {
  if (props.role === "admin") {
    return <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
      Admins automatically get access to all schools, all programs, and full edit permissions.
    </div>;
  }
  if (props.role === "holistic_mentorship_admin") {
    return <>
      <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
        Access includes all Program 1 Schools and only Holistic Mentorship.
      </div>
      <ReadOnlyField value={props.readOnly} onChange={props.onReadOnlyChange} label="Read-only access" />
    </>;
  }
  return <StandardAccessFields {...props} />;
}

function StandardAccessFields(props: AccessFieldsProps) {
  return <>
    <div>
      <label className={labelClassName}>School Access</label>
      <Select value={props.level} onChange={(event) => props.onLevelChange(Number(event.target.value))} className="mt-1 w-full">
        <option value={3}>All Schools - Access to all JNV schools</option>
        <option value={2}>Region - Access to schools in specific regions</option>
        <option value={1}>School - Access to specific schools</option>
      </Select>
    </div>
    <ReadOnlyField value={props.readOnly} onChange={props.onReadOnlyChange} label="Read-only access (cannot edit students)" />
    <ProgramsField selected={props.selectedPrograms} onToggle={props.onToggleProgram} />
    <ScopePicker {...props} />
  </>;
}

function ReadOnlyField({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return <div className="flex items-center">
    <input type="checkbox" id="readOnly" checked={value} onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 rounded border-gray-300 text-accent" />
    <label htmlFor="readOnly" className="ml-2 text-sm text-gray-800">{label}</label>
  </div>;
}

function ProgramsField({ selected, onToggle }: { selected: number[]; onToggle: (programId: number) => void }) {
  const isNVSOnly = selected.length === 1 && selected.includes(64);
  return <div>
    <label className={labelClassName}>Assign Programs</label>
    <p className="text-xs text-gray-500 mb-2">Select which programs this user can access. At least one program is required.</p>
    <div className="mt-2 space-y-2 border rounded-md p-3">
      {PROGRAMS.map((program) => <label key={program.id} className="flex items-start p-2 hover:bg-gray-50 cursor-pointer rounded">
        <input type="checkbox" checked={selected.includes(program.id)} onChange={() => onToggle(program.id)}
          className="h-4 w-4 text-accent rounded border-gray-300 mt-0.5" />
        <div className="ml-3">
          <span className="text-sm font-medium text-gray-900">{program.name}</span>
          <p className="text-xs text-gray-500">{program.description}</p>
        </div>
      </label>)}
    </div>
    {isNVSOnly && <p className="mt-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
      Note: NVS-only users have limited access (students and analytics only, no visits/curriculum).
    </p>}
    {selected.length === 0 && <p className="mt-2 text-xs text-red-600">At least one program must be selected.</p>}
  </div>;
}

function ScopePicker(props: AccessFieldsProps) {
  if (props.level === 2) {
    return <RegionPicker regions={props.regions} selected={props.selectedRegions} onToggle={props.onToggleRegion} />;
  }
  if (props.level === 1) {
    return <SchoolPicker
      search={props.schoolSearch}
      results={props.searchResults}
      selected={props.selectedSchools}
      schoolCodeToName={props.schoolCodeToName}
      onSearchChange={props.onSchoolSearchChange}
      onAdd={props.onAddSchool}
      onRemove={props.onRemoveSchool}
    />;
  }
  return null;
}

function RegionPicker({ regions, selected, onToggle }: {
  regions: string[];
  selected: string[];
  onToggle: (region: string) => void;
}) {
  return <div>
    <label className={labelClassName}>Select Regions</label>
    <div className="mt-2 max-h-48 overflow-y-auto border rounded-md p-2">
      {regions.map((region) => <label key={region} className="flex items-center p-2 hover:bg-gray-50 cursor-pointer">
        <input type="checkbox" checked={selected.includes(region)} onChange={() => onToggle(region)}
          className="h-4 w-4 text-accent rounded border-gray-300" />
        <span className="ml-2 text-sm text-gray-800">{region}</span>
      </label>)}
    </div>
    {selected.length > 0 && <p className="mt-2 text-sm text-gray-500">Selected: {selected.join(", ")}</p>}
  </div>;
}

function SchoolPicker({ search, results, selected, schoolCodeToName, onSearchChange, onAdd, onRemove }: {
  search: string;
  results: School[];
  selected: string[];
  schoolCodeToName: Record<string, string>;
  onSearchChange: (search: string) => void;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  const labelFor = (code: string) => schoolCodeToName[code] ? `${schoolCodeToName[code]} (${code})` : code;
  return <div>
    <label className={labelClassName}>Assign Schools</label>
    <Input type="text" value={search} onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Search schools by name or code..." className="mt-1" />
    {results.length > 0 && <div className="mt-1 max-h-40 overflow-y-auto border rounded-md bg-white shadow-lg">
      {results.map((school) => <button key={school.code} type="button" onClick={() => onAdd(school.code)}
        className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm">
        <span className="font-medium text-gray-900">{school.name}</span>
        <span className="text-gray-600 ml-2">({school.code})</span>
      </button>)}
    </div>}
    {selected.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {selected.map((code) => <span key={code}
        className="inline-flex items-center rounded-full bg-hover-bg px-3 py-1 text-sm text-accent-hover">
        {labelFor(code)}
        <button type="button" onClick={() => onRemove(code)} aria-label={`Remove ${labelFor(code)}`}
          className="ml-2 text-accent hover:text-accent-hover">&times;</button>
      </span>)}
    </div>}
  </div>;
}

function UserFormActions({ isEditing, loading, onClose }: {
  isEditing: boolean;
  loading: boolean;
  onClose: () => void;
}) {
  const label = loading ? "Saving..." : isEditing ? "Save Changes" : "Add User";
  return <div className="mt-6 flex justify-end gap-3">
    <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
    <Button type="submit" size="sm" disabled={loading}>{label}</Button>
  </div>;
}
