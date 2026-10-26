"use client";

import { useState } from "react";
import AddUserModal from "./AddUserModal";
import { Button } from "@/components/ui";
import { isAlumniRole, isPmuRole, PROGRAM_ID_TO_LABEL } from "@/lib/constants";

interface CentreAssignment {
  centreName: string;
  role: string;
}

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
  centres?: CentreAssignment[];
}

interface UserListProps {
  initialUsers: UserPermission[];
  regions: string[];
  /**
   * Map of school code → display name for every JNV school. Used to render the
   * Access column as "Name (CODE)" instead of bare codes, and to label the
   * selected-school chips in AddUserModal. Codes missing from the map fall
   * back to the raw code (e.g. a school that's been deleted).
   */
  schoolCodeToName: Record<string, string>;
  currentUserEmail: string;
  /**
   * True when the viewer is a read-only admin. Hides every mutation control
   * (Add/Edit/Delete) — the admin APIs reject their writes with 403 anyway,
   * this just keeps the UI honest about it.
   */
  viewerReadOnly: boolean;
}

const LEVEL_LABELS: Record<number, string> = {
  3: "All Schools",
  2: "Region",
  1: "School",
};

// PMU roles only ever reach JNV Schools, so their level-3 badge says so.
function levelLabel(user: Pick<UserPermission, "level" | "role">) {
  if (user.level === 3 && isPmuRole(user.role)) return "All JNV Schools";
  return LEVEL_LABELS[user.level];
}

const LEVEL_COLORS: Record<number, string> = {
  3: "bg-hover-bg text-accent-hover",
  2: "bg-green-100 text-green-800",
  1: "bg-gray-100 text-gray-800",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  program_admin: "Program Admin",
  program_manager: "Program Manager",
  holistic_mentorship_admin: "Holistic Mentorship Admin",
  pmu_manager: "PMU Manager",
  pmu_govt_school_user: "PMU Govt School User",
  alumni_manager: "Alumni Manager",
  teacher: "Teacher",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  program_admin: "bg-cyan-100 text-cyan-800",
  program_manager: "bg-indigo-100 text-indigo-800",
  holistic_mentorship_admin: "bg-emerald-100 text-emerald-800",
  pmu_manager: "bg-amber-100 text-amber-800",
  pmu_govt_school_user: "bg-orange-100 text-orange-800",
  alumni_manager: "bg-teal-100 text-teal-800",
  teacher: "bg-gray-100 text-gray-800",
};

const PROGRAM_LABELS = PROGRAM_ID_TO_LABEL;

export default function UserList({ initialUsers, regions, schoolCodeToName, currentUserEmail, viewerReadOnly }: UserListProps) {
  const labelForSchool = (code: string) => {
    const name = schoolCodeToName[code];
    return name ? `${name} (${code})` : code;
  };
  const [users, setUsers] = useState(initialUsers);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserPermission | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const handleDelete = async (id: number, email: string) => {
    if (email.toLowerCase() === currentUserEmail.toLowerCase()) {
      alert("You cannot delete your own account");
      return;
    }

    if (!confirm(`Are you sure you want to delete ${email}?`)) {
      return;
    }

    setDeleting(id);
    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setUsers(users.filter((u) => u.id !== id));
      } else {
        const data = await response.json();
        alert(data.error || "Failed to delete user");
      }
    } catch {
      alert("Failed to delete user");
    } finally {
      setDeleting(null);
    }
  };

  const handleSave = async () => {
    // Refetch users to get updated data
    const response = await fetch("/api/admin/users");
    if (response.ok) {
      const updatedUsers = await response.json();
      setUsers(updatedUsers);
    }
    setShowAddModal(false);
    setEditingUser(null);
  };

  return (
    <>
      <div className="mb-6 flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {viewerReadOnly
            ? "Read-only view of user access levels and permissions"
            : "Manage user access levels and permissions"}
        </div>
        {!viewerReadOnly && (
          <Button
            onClick={() => setShowAddModal(true)}
            size="sm"
          >
            Add User
          </Button>
        )}
      </div>

      <div className="overflow-x-auto bg-white shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                Email
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Name
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Role
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Level
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Programs
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Access
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                  {user.email}
                  {user.email.toLowerCase() === currentUserEmail.toLowerCase() && (
                    <span className="ml-2 text-xs text-gray-400">(you)</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  {user.full_name || "\u2014"}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${ROLE_COLORS[user.role] || ROLE_COLORS.teacher}`}>
                    {ROLE_LABELS[user.role] || "Teacher"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${LEVEL_COLORS[user.level]}`}>
                    {levelLabel(user)}
                  </span>
                  <span className={`ml-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                    user.read_only
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-green-100 text-green-800"
                  }`}>
                    {user.read_only ? "Read-only" : "Read/Write"}
                  </span>
                </td>
                <td className="px-3 py-4 text-sm">
                  <ProgramsCell role={user.role} programIds={user.program_ids} />
                </td>
                <td className="px-3 py-4 text-sm text-gray-500">
                  <AccessCell user={user} labelForSchool={labelForSchool} />
                </td>
                <td className="px-3 py-4 text-sm">
                  {viewerReadOnly ? (
                    <span className="text-xs text-gray-400">Read-only</span>
                  ) : (
                    <ActionsCell
                      seated={(user.centres?.length ?? 0) > 0}
                      deleting={deleting === user.id}
                      isSelf={user.email.toLowerCase() === currentUserEmail.toLowerCase()}
                      onEdit={() => setEditingUser(user)}
                      onDelete={() => handleDelete(user.id, user.email)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showAddModal || editingUser) && (
        <AddUserModal
          user={editingUser}
          regions={regions}
          schoolCodeToName={schoolCodeToName}
          onClose={() => {
            setShowAddModal(false);
            setEditingUser(null);
          }}
          onSave={handleSave}
        />
      )}
    </>
  );
}

/** A user's Programs as chips; Alumni Managers have none by design (ADR 0008), which isn't an error. */
function ProgramsCell({ role, programIds }: { role: string; programIds: number[] | null }) {
  if (programIds && programIds.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {programIds.map((id) => (
          <span
            key={id}
            className="inline-flex px-2 py-0.5 text-xs rounded-full bg-hover-bg text-accent-hover"
          >
            {PROGRAM_LABELS[id] || `Program ${id}`}
          </span>
        ))}
      </div>
    );
  }
  if (isAlumniRole(role)) return <span className="text-gray-500 text-xs">Not used</span>;
  return <span className="text-red-500 text-xs">No programs</span>;
}

/** Where the user's access comes from: centre seats, then their level's schools or regions. */
function AccessCell({ user, labelForSchool }: { user: UserPermission; labelForSchool: (code: string) => string }) {
  const seated = (user.centres?.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-1">
      {seated && (
        <div className="flex flex-wrap gap-1">
          {user.centres!.map((centre, i) => (
            <span
              key={`${centre.centreName}-${centre.role}-${i}`}
              className="inline-flex px-2 py-0.5 text-xs rounded-full bg-hover-bg text-accent-hover"
              title="Centre assignment — manage in Staff"
            >
              {centre.centreName} &middot; {centre.role}
            </span>
          ))}
        </div>
      )}
      <ExplicitScope user={user} seated={seated} labelForSchool={labelForSchool} />
    </div>
  );
}

function ExplicitScope({ user, seated, labelForSchool }: {
  user: UserPermission;
  seated: boolean;
  labelForSchool: (code: string) => string;
}) {
  if (user.level === 3) return <span className="text-gray-400">All JNV schools</span>;
  if (user.level === 2 && user.regions?.length) return <span>{user.regions.join(", ")}</span>;
  if (user.level === 1 && user.school_codes?.length) {
    return (
      <div className="flex flex-col gap-0.5">
        {user.school_codes.map((code) => (
          <span key={code}>{labelForSchool(code)}</span>
        ))}
      </div>
    );
  }
  if (seated) return null;
  return <span>{user.level === 2 ? "No regions assigned" : "No schools assigned"}</span>;
}

/** Edit / Delete. Seated users' scope comes from their centre, so it's edited in Staff Management (the API refuses it too). */
function ActionsCell({ seated, deleting, isSelf, onEdit, onDelete }: {
  seated: boolean;
  deleting: boolean;
  isSelf: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="flex items-center whitespace-nowrap">
        {seated ? (
          <span
            className="mr-2"
            title="This user is assigned to a centre. Edit their access in Staff Management."
          >
            <Button variant="ghost" size="sm" disabled>
              Edit
            </Button>
          </span>
        ) : (
          <Button variant="ghost" size="sm" onClick={onEdit} className="mr-2">
            Edit
          </Button>
        )}
        <Button variant="danger-ghost" size="sm" onClick={onDelete} disabled={deleting || isSelf}>
          {deleting ? "Deleting..." : "Delete"}
        </Button>
      </div>
      {seated && <p className="mt-1 text-xs text-gray-400">Edit in Staff Management only</p>}
    </>
  );
}
