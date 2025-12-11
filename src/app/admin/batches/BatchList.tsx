"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BatchMetadata {
  stream?: string;
  grade?: number;
}

interface Batch {
  id: number;
  name: string;
  batch_id: string;
  program_id: number;
  metadata: BatchMetadata | null;
}

interface Program {
  id: number;
  name: string;
}

interface BatchListProps {
  initialBatches: Batch[];
  programs: Program[];
  initialProgramId: number;
}

const STREAM_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "engineering", label: "Engineering" },
  { value: "medical", label: "Medical" },
  { value: "ca", label: "CA" },
  { value: "clat", label: "CLAT" },
  { value: "pcmb", label: "PCMB" },
  { value: "pcb", label: "PCB" },
  { value: "pcm", label: "PCM" },
  { value: "foundation", label: "Foundation" },
];

const GRADE_OPTIONS = [
  { value: 0, label: "Not set" },
  { value: 9, label: "Grade 9" },
  { value: 10, label: "Grade 10" },
  { value: 11, label: "Grade 11" },
  { value: 12, label: "Grade 12" },
];

export default function BatchList({
  initialBatches,
  programs,
  initialProgramId,
}: BatchListProps) {
  const [batches, setBatches] = useState(initialBatches);
  const [selectedProgramId, setSelectedProgramId] = useState(initialProgramId);
  const [editingBatchId, setEditingBatchId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<BatchMetadata>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleProgramChange = async (programId: number) => {
    setSelectedProgramId(programId);
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/batches?program_id=${programId}`);
      if (response.ok) {
        const newBatches = await response.json();
        setBatches(newBatches);
      } else {
        setError("Failed to fetch batches");
      }
    } catch {
      setError("Failed to fetch batches");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (batch: Batch) => {
    setEditingBatchId(batch.id);
    setEditValues({
      stream: batch.metadata?.stream || "",
      grade: batch.metadata?.grade || 0,
    });
    setError("");
  };

  const cancelEdit = () => {
    setEditingBatchId(null);
    setEditValues({});
  };

  const saveEdit = async (batchId: number) => {
    setSaving(true);
    setError("");

    try {
      const metadata: BatchMetadata = {};
      if (editValues.stream) {
        metadata.stream = editValues.stream;
      }
      if (editValues.grade && editValues.grade > 0) {
        metadata.grade = editValues.grade;
      }

      const response = await fetch(`/api/batches/${batchId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metadata }),
      });

      if (response.ok) {
        const updatedBatch = await response.json();
        setBatches(
          batches.map((b) => (b.id === batchId ? updatedBatch : b))
        );
        setEditingBatchId(null);
        setEditValues({});
      } else {
        const data = await response.json();
        setError(data.error || "Failed to update batch");
      }
    } catch {
      setError("Failed to update batch");
    } finally {
      setSaving(false);
    }
  };

  const selectedProgram = programs.find((p) => p.id === selectedProgramId);

  return (
    <>
      {/* Program Selector */}
      <div className="mb-6 bg-white shadow rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Program
        </label>
        <select
          value={selectedProgramId}
          onChange={(e) => handleProgramChange(Number(e.target.value))}
          disabled={loading}
          className="block w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
        >
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-gray-500">
          Select a program to view and edit its batch metadata
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          Loading batches...
        </div>
      ) : (
        <div className="overflow-x-auto bg-white shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                  Batch Name
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Batch ID
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Stream
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Grade
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {batches.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-sm text-gray-500"
                  >
                    No batches found for {selectedProgram?.name || "this program"}
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                      {batch.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {batch.batch_id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      {editingBatchId === batch.id ? (
                        <select
                          value={editValues.stream || ""}
                          onChange={(e) =>
                            setEditValues({ ...editValues, stream: e.target.value })
                          }
                          className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {STREAM_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            batch.metadata?.stream
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {batch.metadata?.stream
                            ? STREAM_OPTIONS.find(
                                (o) => o.value === batch.metadata?.stream
                              )?.label || batch.metadata.stream
                            : "Not set"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      {editingBatchId === batch.id ? (
                        <select
                          value={editValues.grade || 0}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              grade: Number(e.target.value),
                            })
                          }
                          className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {GRADE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            batch.metadata?.grade
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {batch.metadata?.grade
                            ? `Grade ${batch.metadata.grade}`
                            : "Not set"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      {editingBatchId === batch.id ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(batch.id)}
                            disabled={saving}
                            className="text-green-600 hover:text-green-800 disabled:text-gray-400"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="text-gray-600 hover:text-gray-800 disabled:text-gray-400"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(batch)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
