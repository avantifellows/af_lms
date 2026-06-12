"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Edit2, Plus, Search, UserX, X } from "lucide-react";

import StatCard from "@/components/StatCard";
import { Badge, Button, Card, Input, Modal, Select } from "@/components/ui";
import { DetailField } from "@/components/ui/DetailField";
import {
  SEAT_ROLES,
  type RosterCodeFilter,
  type RosterKindFilter,
  type SeatRole,
  type StaffRosterFilters,
  type StaffRosterRow,
  type StaffRosterSummary,
} from "@/lib/staff-shared";

interface StaffGridProps {
  initialRows: StaffRosterRow[];
  initialSummary: StaffRosterSummary;
  initialFilters: StaffRosterFilters;
}

interface CentreOptionItem {
  id: number;
  name: string;
}

const KIND_LABELS: Record<StaffRosterRow["kind"], string> = {
  teacher: "Teacher",
  staff: "PM / Staff",
  pending_teacher: "Teacher (not backfilled)",
  pending_pm: "PM (no staff record)",
};

const ROLE_LABELS: Record<StaffRosterRow["kind"], string> = {
  teacher: "Teacher",
  staff: "PM",
  pending_teacher: "Teacher",
  pending_pm: "PM",
};

const SEAT_ROLE_LABELS: Record<SeatRole, string> = {
  physics: "Physics",
  chemistry: "Chemistry",
  maths: "Maths",
  biology: "Biology",
  apc: "APC",
  pm: "PM",
};

function rowKey(row: StaffRosterRow): string {
  return `${row.kind}:${row.recordId}`;
}

interface CentreGroup {
  centreId: number | null;
  centreName: string;
  rows: StaffRosterRow[];
}

function groupByCentre(rows: StaffRosterRow[]): CentreGroup[] {
  const groups = new Map<number, CentreGroup>();
  const unassigned: CentreGroup = {
    centreId: null,
    centreName: "No Centre assigned",
    rows: [],
  };

  for (const row of rows) {
    if (row.seats.length === 0) {
      unassigned.rows.push(row);
      continue;
    }
    const seen = new Set<number>();
    for (const seat of row.seats) {
      if (seen.has(seat.centreId)) continue;
      seen.add(seat.centreId);
      let group = groups.get(seat.centreId);
      if (!group) {
        group = { centreId: seat.centreId, centreName: seat.centreName, rows: [] };
        groups.set(seat.centreId, group);
      }
      group.rows.push(row);
    }
  }

  const sorted = [...groups.values()].sort((a, b) =>
    a.centreName.localeCompare(b.centreName)
  );
  if (unassigned.rows.length > 0) sorted.push(unassigned);
  return sorted;
}

export default function StaffGrid({
  initialRows,
  initialSummary,
  initialFilters,
}: StaffGridProps) {
  const [rows, setRows] = useState(initialRows);
  const [summary, setSummary] = useState(initialSummary);
  const [filters, setFilters] = useState<StaffRosterFilters>(initialFilters);
  const [loading, setLoading] = useState(false);
  const [tableError, setTableError] = useState("");
  const [centres, setCentres] = useState<CentreOptionItem[]>([]);

  // Edit modal state
  const [modalKey, setModalKey] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  const [exitDraft, setExitDraft] = useState("");
  const [exitArmed, setExitArmed] = useState(false);
  const [seatCentreDraft, setSeatCentreDraft] = useState("");
  const [seatRoleDraft, setSeatRoleDraft] = useState<SeatRole>("physics");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const modalRow = useMemo(
    () => (modalKey === null ? null : (rows.find((row) => rowKey(row) === modalKey) ?? null)),
    [modalKey, rows]
  );

  const fetchRoster = useCallback(async (nextFilters: StaffRosterFilters) => {
    setLoading(true);
    setTableError("");
    try {
      const params = new URLSearchParams();
      if (nextFilters.search) params.set("search", nextFilters.search);
      if (nextFilters.kind !== "all") params.set("kind", nextFilters.kind);
      if (nextFilters.code !== "all") params.set("code", nextFilters.code);
      if (nextFilters.exited === "include") params.set("exited", "include");
      if (nextFilters.centreId !== null)
        params.set("centre", String(nextFilters.centreId));
      const response = await fetch(`/api/admin/staff?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load roster");
      setRows(data.rows);
      setSummary(data.summary);
    } catch (error) {
      setTableError(
        error instanceof Error ? error.message : "Failed to load roster"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced refetch when filters change.
  useEffect(() => {
    if (filters === initialFilters) return;
    const timeout = window.setTimeout(() => {
      void fetchRoster(filters);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filters, initialFilters, fetchRoster]);

  // Centres list for the filter + add-seat picker.
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/centres?limit=100");
        const data = await response.json();
        if (response.ok && Array.isArray(data.rows)) {
          setCentres(
            data.rows.map((row: { id: number; name: string }) => ({
              id: row.id,
              name: row.name,
            }))
          );
        }
      } catch {
        // Filter falls back to the centres present in roster rows.
      }
    })();
  }, []);

  const groups = useMemo(() => {
    const grouped = groupByCentre(rows);
    return filters.centreId === null
      ? grouped
      : grouped.filter((group) => group.centreId === filters.centreId);
  }, [rows, filters.centreId]);

  const openModal = (row: StaffRosterRow) => {
    setModalKey(rowKey(row));
    setCodeDraft(row.employeeCode ?? "");
    setExitDraft(new Date().toISOString().slice(0, 10));
    setExitArmed(false);
    setSeatCentreDraft("");
    setSeatRoleDraft(row.kind === "teacher" ? "physics" : "pm");
    setActionError("");
  };

  const closeModal = () => {
    setModalKey(null);
    setActionError("");
  };

  const runAction = async (
    action: () => Promise<Response>,
    { closeOnSuccess = false } = {}
  ) => {
    setActionBusy(true);
    setActionError("");
    try {
      const response = await action();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const fieldError =
          data.fields && typeof data.fields === "object"
            ? Object.values(data.fields as Record<string, string>)[0]
            : undefined;
        throw new Error(fieldError || data.error || "Action failed");
      }
      await fetchRoster(filters);
      if (closeOnSuccess) closeModal();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
      return false;
    } finally {
      setActionBusy(false);
    }
  };

  const saveCode = (row: StaffRosterRow) => {
    const code = codeDraft.trim().toUpperCase();
    if (!code || code === row.employeeCode) {
      closeModal();
      return Promise.resolve(true);
    }
    if (row.kind === "teacher") {
      return runAction(
        () =>
          fetch(`/api/admin/staff/teachers/${row.recordId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teacher_id: code }),
          }),
        { closeOnSuccess: true }
      );
    }
    if (row.kind === "staff") {
      return runAction(
        () =>
          fetch(`/api/admin/staff/members/${row.recordId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_code: code }),
          }),
        { closeOnSuccess: true }
      );
    }
    // pending_pm: creating the staff record IS setting the code
    return runAction(
      () =>
        fetch(`/api/admin/staff/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_permission_id: row.recordId,
            employee_code: code,
          }),
        }),
      { closeOnSuccess: true }
    );
  };

  const saveExit = (row: StaffRosterRow) => {
    const url =
      row.kind === "teacher"
        ? `/api/admin/staff/teachers/${row.recordId}`
        : `/api/admin/staff/members/${row.recordId}`;
    return runAction(
      () =>
        fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exit_date: exitDraft }),
        }),
      { closeOnSuccess: true }
    );
  };

  const addSeat = (row: StaffRosterRow) => {
    return runAction(() =>
      fetch(`/api/admin/staff/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          centre_id: Number(seatCentreDraft),
          role: seatRoleDraft,
          user_id: row.userId,
        }),
      })
    );
  };

  const vacateSeat = (seatId: number) => {
    return runAction(() =>
      fetch(`/api/admin/staff/positions/${seatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: null }),
      })
    );
  };

  const canEdit = (row: StaffRosterRow) => row.kind !== "pending_teacher";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="People" value={summary.total} size="sm" />
        <StatCard label="Teachers" value={summary.teachers} size="sm" />
        <StatCard label="PM / Staff" value={summary.staff} size="sm" />
        <StatCard label="Pending" value={summary.pending} size="sm" color="brand-amber" />
        <StatCard
          label="Missing AF ID"
          value={summary.missingCode}
          size="sm"
          color="brand-coral"
        />
        <StatCard label="Open positions" value={summary.vacantSeats} size="sm" />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <Input
                value={filters.search}
                onChange={(event) =>
                  setFilters({ ...filters, search: event.target.value })
                }
                placeholder="Name, email or AF code"
                className="pl-9"
                aria-label="Search staff"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              Centre
            </label>
            <Select
              value={filters.centreId === null ? "" : String(filters.centreId)}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  centreId: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              aria-label="Filter by Centre"
            >
              <option value="">All Centres</option>
              {centres.map((centre) => (
                <option key={centre.id} value={centre.id}>
                  {centre.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              Type
            </label>
            <Select
              value={filters.kind}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  kind: event.target.value as RosterKindFilter,
                })
              }
              aria-label="Filter by type"
            >
              <option value="all">All</option>
              <option value="teacher">Teachers</option>
              <option value="staff">PM / Staff</option>
              <option value="pending_teacher">Pending teachers</option>
              <option value="pending_pm">Pending PMs</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              AF code
            </label>
            <Select
              value={filters.code}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  code: event.target.value as RosterCodeFilter,
                })
              }
              aria-label="Filter by AF code"
            >
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="present">Present</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              Exited
            </label>
            <Select
              value={filters.exited}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  exited:
                    event.target.value === "include" ? "include" : "exclude",
                })
              }
              aria-label="Filter exited"
            >
              <option value="exclude">Hide exited</option>
              <option value="include">Show exited</option>
            </Select>
          </div>
        </div>
      </Card>

      {tableError && (
        <div className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {tableError}
        </div>
      )}

      {loading && (
        <p className="text-sm text-text-muted" role="status">
          Loading roster…
        </p>
      )}

      {groups.length === 0 && !loading && (
        <Card className="p-6 text-sm text-text-muted">
          No people match the current filters.
        </Card>
      )}

      {groups.map((group) => (
        <section key={group.centreId ?? "none"}>
          <div className="mb-2 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-text-muted" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">
              {group.centreName}
            </h2>
            <span className="text-xs font-mono text-text-muted">
              {group.rows.length}
            </span>
          </div>
          <div className="space-y-2">
            {group.rows.map((row) => (
              <Card key={`${group.centreId}:${rowKey(row)}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-text-primary">
                        {row.name || "(no name)"}
                      </span>
                      {row.employeeCode ? (
                        <Badge variant="success">{row.employeeCode}</Badge>
                      ) : row.exitDate ? null : (
                        <Badge variant="danger">No AF ID</Badge>
                      )}
                      {(row.kind === "pending_teacher" ||
                        row.kind === "pending_pm") && (
                        <Badge variant="warning">{KIND_LABELS[row.kind]}</Badge>
                      )}
                      {row.exitDate && (
                        <Badge variant="warning">Exited {row.exitDate}</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-4">
                      <DetailField label="Email" value={row.email ?? "—"} />
                      <DetailField label="Role" value={ROLE_LABELS[row.kind]} />
                      <DetailField
                        label="Subject"
                        value={row.subjectName ?? "—"}
                      />
                      <DetailField
                        label="Centre"
                        value={
                          group.centreId !== null
                            ? group.centreName
                            : row.seats.length > 0
                              ? [...new Set(row.seats.map((seat) => seat.centreName))].join(", ")
                              : "—"
                        }
                      />
                    </div>
                  </div>
                  {canEdit(row) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openModal(row)}
                      aria-label={`Edit ${row.name || row.email}`}
                    >
                      <Edit2 className="mr-1 h-4 w-4" /> Edit
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Modal open={modalRow !== null} onClose={closeModal} className="max-w-xl">
        {modalRow && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-text-primary">
                  {modalRow.name || "(no name)"}
                </h3>
                <p className="text-sm text-text-muted">
                  {KIND_LABELS[modalRow.kind]} · {modalRow.email ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-text-muted hover:text-text-primary"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                {modalRow.kind === "pending_pm"
                  ? "AF code (creates the staff record)"
                  : "AF code"}
              </label>
              <Input
                value={codeDraft}
                onChange={(event) => setCodeDraft(event.target.value)}
                placeholder="AF123"
                aria-label="Employee code"
                className="w-40"
              />
            </div>

            {modalRow.userId !== null && (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                  Assigned Centres
                </h4>
                {modalRow.seats.length === 0 ? (
                  <p className="text-sm text-text-muted">No Centre assigned</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {modalRow.seats.map((seat) => (
                      <li
                        key={seat.id}
                        className="flex items-center gap-2 rounded-md border border-border bg-bg-card-alt px-2 py-1 text-sm"
                      >
                        <span>
                          {SEAT_ROLE_LABELS[seat.role]} @ {seat.centreName}
                        </span>
                        <button
                          type="button"
                          onClick={() => void vacateSeat(seat.id)}
                          disabled={actionBusy}
                          className="text-danger hover:text-danger/80"
                          aria-label={`Remove ${SEAT_ROLE_LABELS[seat.role]} assignment at ${seat.centreName}`}
                          title="Remove assignment (keeps the position open)"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                    Assign new Centre
                  </h4>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      value={seatCentreDraft}
                      onChange={(event) => setSeatCentreDraft(event.target.value)}
                      aria-label="Assign centre"
                      className="min-w-0 flex-1"
                    >
                      <option value="">Select Centre…</option>
                      {centres.map((centre) => (
                        <option key={centre.id} value={centre.id}>
                          {centre.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={seatRoleDraft}
                      onChange={(event) =>
                        setSeatRoleDraft(event.target.value as SeatRole)
                      }
                      aria-label="Assign role"
                      className="sm:w-36"
                    >
                      {SEAT_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {SEAT_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void addSeat(modalRow)}
                      disabled={actionBusy || !seatCentreDraft}
                      className="shrink-0 whitespace-nowrap"
                    >
                      <Plus className="mr-1 h-4 w-4" /> Assign
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {(modalRow.kind === "teacher" || modalRow.kind === "staff") &&
              !modalRow.exitDate && (
                <div className="mt-5 rounded-md border border-danger/30 bg-danger-bg/40 p-3">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-danger">
                    Mark exited
                  </h4>
                  {exitArmed ? (
                    <div className="mt-2 flex items-end gap-2">
                      <span>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                          Exit date
                        </label>
                        <Input
                          type="date"
                          value={exitDraft}
                          onChange={(event) => setExitDraft(event.target.value)}
                          aria-label="Exit date"
                        />
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void saveExit(modalRow)}
                        disabled={actionBusy || !exitDraft}
                      >
                        <UserX className="mr-1 h-4 w-4" /> Confirm exit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setExitArmed(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-text-muted">
                      Removes all Centre assignments and revokes LMS access.{" "}
                      <button
                        type="button"
                        onClick={() => setExitArmed(true)}
                        className="font-bold text-danger hover:underline"
                      >
                        Mark exited…
                      </button>
                    </p>
                  )}
                </div>
              )}

            {actionError && (
              <p className="mt-4 text-sm text-danger" role="alert">
                {actionError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                onClick={() => void saveCode(modalRow)}
                disabled={actionBusy}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
