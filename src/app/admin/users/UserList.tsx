"use client";

import { useState } from "react";
import AddUserModal from "./AddUserModal";

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

interface UserListProps {
  initialUsers: UserPermission[];
  regions: string[];
  currentUserEmail: string;
}

const LEVEL_LABELS: Record<number, string> = {
  3: "All Schools",
  2: "Region",
  1: "School",
};

const LEVEL_COLORS: Record<number, string> = {
  3: "bg-blue-100 text-blue-800",
  2: "bg-green-100 text-green-800",
  1: "bg-gray-100 text-gray-800",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  program_admin: "Program Admin",
  program_manager: "Program Manager",
  teacher: "Teacher",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  program_admin: "bg-cyan-100 text-cyan-800",
  program_manager: "bg-indigo-100 text-indigo-800",
  teacher: "bg-gray-100 text-gray-800",
};

const PROGRAM_LABELS: Record<number, string> = {
  1: "CoE",
  2: "Nodal",
  64: "NVS",
};

export default function UserList({ initialUsers, regions, currentUserEmail }: UserListProps) {
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
          Manage user access levels and permissions
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add User
        </button>
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
                    {LEVEL_LABELS[user.level]}
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
                  {user.program_ids && user.program_ids.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {user.program_ids.map((id) => (
                        <span
                          key={id}
                          className="inline-flex px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800"
                        >
                          {PROGRAM_LABELS[id] || `Program ${id}`}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-red-500 text-xs">No programs</span>
                  )}
                </td>
                <td className="px-3 py-4 text-sm text-gray-500">
                  {user.level === 3 ? (
                    <span className="text-gray-400">All JNV schools</span>
                  ) : user.level === 2 ? (
                    <span>{user.regions?.join(", ") || "No regions assigned"}</span>
                  ) : (
                    <span>{user.school_codes?.join(", ") || "No schools assigned"}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <button
                    onClick={() => setEditingUser(user)}
                    className="text-blue-600 hover:text-blue-800 mr-4"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(user.id, user.email)}
                    disabled={deleting === user.id || user.email.toLowerCase() === currentUserEmail.toLowerCase()}
                    className="text-red-600 hover:text-red-800 disabled:text-gray-300 disabled:cursor-not-allowed"
                  >
                    {deleting === user.id ? "Deleting..." : "Delete"}
                  </button>
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
