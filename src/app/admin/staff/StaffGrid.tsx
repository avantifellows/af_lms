"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Edit2, Plus, Search, UserX, X } from "lucide-react";

import StatCard from "@/components/StatCard";
import { Badge, Button, Card, Input, Modal, Select } from "@/components/ui";
import { DetailField } from "@/components/ui/DetailField";
import {
  PM_SEAT_ROLES,
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

interface SubjectOptionItem {
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
  apm: "APM",
  spm: "SPM",
  ph: "PH",
  subject_tbd: "Subject TBD",
};

// Subject-teaching seat roles (everything that isn't a PM/management tier).
const TEACHER_SEAT_ROLES = SEAT_ROLES.filter(
  (role) => !(PM_SEAT_ROLES as readonly SeatRole[]).includes(role)
);

// The roles offered when editing a seat: PM tiers for staff/PM rows, subject
// roles for teachers. Keeps a PM from being re-tagged "Physics" and vice versa.
function seatRoleOptionsFor(
  kind: StaffRosterRow["kind"]
): readonly SeatRole[] {
  return kind === "teacher" || kind === "pending_teacher"
    ? TEACHER_SEAT_ROLES
    : PM_SEAT_ROLES;
}

function rowKey(row: StaffRosterRow): string {
  return `${row.kind}:${row.recordId}`;
}

// In the centre-grouped view a staff member's role is the tier of the seat they
// hold AT THAT centre (PH/SPM/APM/PM) — not the coarse roster kind, which
// collapses every staff tier to "PM". Teachers keep "Teacher" (their subject is
// shown in its own column, so the seat role would just duplicate it). Falls back
// to the kind label when there's no seat for the centre (e.g. "No Centre").
function roleLabelForCentre(
  row: StaffRosterRow,
  centreId: number | null
): string {
  if (row.kind === "staff" && centreId !== null) {
    const seat = row.seats.find((s) => s.centreId === centreId);
    if (seat) return SEAT_ROLE_LABELS[seat.role];
  }
  return ROLE_LABELS[row.kind];
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
  // Create-teacher form (completing a pending_teacher): chosen subject + centre.
  const [subjects, setSubjects] = useState<SubjectOptionItem[]>([]);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [createCentreDraft, setCreateCentreDraft] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  // Seat id awaiting a "remove anyway" confirmation (the server flagged it as
  // the person's last seat). Null when no confirmation is pending.
  const [confirmVacateSeatId, setConfirmVacateSeatId] = useState<number | null>(
    null
  );

  // Add-User (from-scratch) modal state.
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addKind, setAddKind] = useState<"teacher" | "staff">("teacher");
  const [addSubject, setAddSubject] = useState("");
  const [addSeatRole, setAddSeatRole] = useState<SeatRole>("pm");
  const [addCentre, setAddCentre] = useState("");
  const [addCode, setAddCode] = useState("");

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

  // Subject list for the create-teacher dropdown.
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/subjects");
        const data = await response.json();
        if (response.ok && Array.isArray(data.subjects)) {
          setSubjects(data.subjects);
        }
      } catch {
        // Create-teacher subject dropdown will be empty; form stays blocked.
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
    setSubjectDraft("");
    setCreateCentreDraft("");
    setActionError("");
  };

  const closeModal = () => {
    setModalKey(null);
    setActionError("");
    setConfirmVacateSeatId(null);
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

  // Complete a pending_teacher: create the teacher record + seat at the chosen
  // centre. Subject + centre are required; AF id is optional (a not-yet-hired
  // teacher gets it later via the normal edit flow). row.recordId is the
  // user_permission id for pending rows.
  const createTeacher = (row: StaffRosterRow) => {
    const code = codeDraft.trim().toUpperCase();
    return runAction(
      () =>
        fetch(`/api/admin/staff/teachers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_permission_id: row.recordId,
            subject_id: Number(subjectDraft),
            centre_id: Number(createCentreDraft),
            teacher_id: code || undefined,
          }),
        }),
      { closeOnSuccess: true }
    );
  };

  const openAddModal = () => {
    setAddName("");
    setAddEmail("");
    setAddKind("teacher");
    setAddSubject("");
    setAddSeatRole("pm");
    setAddCentre("");
    setAddCode("");
    setAddError("");
    setAddOpen(true);
  };
  const closeAddModal = () => {
    setAddOpen(false);
    setAddError("");
  };

  // Create a new centre-staff person + seat in one atomic call (server does the
  // permission + user + teacher/staff + seat together).
  const submitAddUser = async () => {
    setAddBusy(true);
    setAddError("");
    try {
      const response = await fetch(`/api/admin/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: addEmail.trim(),
          full_name: addName.trim() || undefined,
          kind: addKind,
          centre_id: Number(addCentre),
          subject_id: addKind === "teacher" ? Number(addSubject) : undefined,
          role: addKind === "staff" ? addSeatRole : undefined,
          af_id: addCode.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const fieldError =
          data.fields && typeof data.fields === "object"
            ? Object.values(data.fields as Record<string, string>)[0]
            : undefined;
        throw new Error(fieldError || data.error || "Failed to add user");
      }
      await fetchRoster(filters);
      closeAddModal();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add user");
    } finally {
      setAddBusy(false);
    }
  };

  const addValid =
    addEmail.trim().includes("@") &&
    !!addCentre &&
    (addKind === "teacher" ? !!addSubject : true);

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

  // Change a person's org tier (role). It's a person-level attribute, so this
  // updates every active seat they hold at once; refreshing reflects the new
  // tier in each centre's Role column.
  const changeRole = (row: StaffRosterRow, role: SeatRole) =>
    runAction(() =>
      fetch(`/api/admin/staff/positions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: row.userId, role }),
      })
    );

  // Vacate a seat. The server blocks removing a person's *last* seat (409 with
  // code "last_seat") unless force=true; on that block we surface an inline
  // "remove anyway" confirmation rather than failing silently.
  const vacateSeat = async (seatId: number, force = false) => {
    setActionBusy(true);
    setActionError("");
    try {
      const url = `/api/admin/staff/positions/${seatId}${force ? "?force=true" : ""}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && data.code === "last_seat") {
          setConfirmVacateSeatId(seatId);
          return false;
        }
        throw new Error(data.error || "Action failed");
      }
      setConfirmVacateSeatId(null);
      await fetchRoster(filters);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
      return false;
    } finally {
      setActionBusy(false);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Add centre staff (teachers &amp; PMs) and seat them here — no separate
          permissions step.
        </p>
        <Button onClick={openAddModal} aria-label="Add user" className="shrink-0">
          <Plus className="mr-1 h-4 w-4" /> Add User
        </Button>
      </div>

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
                      <DetailField
                        label="Role"
                        value={roleLabelForCentre(row, group.centreId)}
                      />
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
                  {/* Every row is editable — pending_teacher opens the
                      create-teacher flow; others open the edit/seat modal. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openModal(row)}
                    aria-label={`Edit ${row.name || row.email}`}
                  >
                    <Edit2 className="mr-1 h-4 w-4" /> Edit
                  </Button>
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
                  : modalRow.kind === "pending_teacher"
                    ? "AF id (optional)"
                    : "AF code"}
              </label>
              <Input
                value={codeDraft}
                onChange={(event) => setCodeDraft(event.target.value)}
                placeholder="AF123"
                aria-label="Employee code"
                className="w-40"
              />
              {modalRow.kind === "pending_teacher" && (
                <p className="mt-1 text-xs text-text-muted">
                  Leave blank for a not-yet-hired teacher — set it later via Edit.
                </p>
              )}
            </div>

            {modalRow.kind === "pending_teacher" && (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                  Create teacher record
                </h4>
                <p className="mb-3 text-sm text-text-muted">
                  Creates the teacher and seats them at a centre.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="flex-1">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                      Subject
                    </span>
                    <Select
                      value={subjectDraft}
                      onChange={(event) => setSubjectDraft(event.target.value)}
                      aria-label="Subject"
                      className="w-full"
                    >
                      <option value="">Select Subject…</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex-1">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                      Centre
                    </span>
                    <Select
                      value={createCentreDraft}
                      onChange={(event) =>
                        setCreateCentreDraft(event.target.value)
                      }
                      aria-label="Centre"
                      className="w-full"
                    >
                      <option value="">Select Centre…</option>
                      {centres.map((centre) => (
                        <option key={centre.id} value={centre.id}>
                          {centre.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              </div>
            )}

            {modalRow.userId !== null &&
              (modalRow.kind === "staff" || modalRow.kind === "pending_pm") &&
              modalRow.seats.length > 0 && (
                <div className="mt-5">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                    Role
                  </h4>
                  <Select
                    value={modalRow.seats[0].role}
                    onChange={(event) =>
                      void changeRole(modalRow, event.target.value as SeatRole)
                    }
                    disabled={actionBusy}
                    aria-label="Edit role"
                    className="w-40"
                  >
                    {seatRoleOptionsFor(modalRow.kind).map((role) => (
                      <option key={role} value={role}>
                        {SEAT_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-text-muted">
                    Applies to all of this person&apos;s centres.
                  </p>
                </div>
              )}

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
                        {confirmVacateSeatId === seat.id ? (
                          <span className="flex items-center gap-2">
                            <span className="text-xs text-brand-coral">
                              Only seat — remove anyway?
                            </span>
                            <button
                              type="button"
                              onClick={() => void vacateSeat(seat.id, true)}
                              disabled={actionBusy}
                              className="text-xs font-bold text-danger hover:text-danger/80"
                            >
                              Remove
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmVacateSeatId(null)}
                              disabled={actionBusy}
                              className="text-xs text-text-muted hover:text-text"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
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
                        )}
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
              {modalRow.kind === "pending_teacher" ? (
                <Button
                  onClick={() => void createTeacher(modalRow)}
                  disabled={actionBusy || !subjectDraft || !createCentreDraft}
                >
                  Create teacher
                </Button>
              ) : (
                <Button
                  onClick={() => void saveCode(modalRow)}
                  disabled={actionBusy}
                >
                  Save
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={addOpen} onClose={closeAddModal} className="max-w-xl">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-text-primary">Add User</h3>
              <p className="text-sm text-text-muted">
                Creates the person and seats them at a centre in one step.
              </p>
            </div>
            <button
              type="button"
              onClick={closeAddModal}
              className="text-text-muted hover:text-text-primary"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Full name
              </span>
              <Input
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                placeholder="Jane Doe"
                aria-label="Full name"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Email
              </span>
              <Input
                value={addEmail}
                onChange={(event) => setAddEmail(event.target.value)}
                placeholder="jane@avantifellows.org"
                aria-label="Email"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Type
              </span>
              <Select
                value={addKind}
                onChange={(event) =>
                  setAddKind(event.target.value as "teacher" | "staff")
                }
                aria-label="Type"
              >
                <option value="teacher">Teacher</option>
                <option value="staff">PM / Staff</option>
              </Select>
            </label>
            {addKind === "teacher" ? (
              <label>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                  Subject
                </span>
                <Select
                  value={addSubject}
                  onChange={(event) => setAddSubject(event.target.value)}
                  aria-label="Subject"
                >
                  <option value="">Select Subject…</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <label>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                  Role
                </span>
                <Select
                  value={addSeatRole}
                  onChange={(event) =>
                    setAddSeatRole(event.target.value as SeatRole)
                  }
                  aria-label="Role"
                >
                  {PM_SEAT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {SEAT_ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Centre
              </span>
              <Select
                value={addCentre}
                onChange={(event) => setAddCentre(event.target.value)}
                aria-label="Centre"
              >
                <option value="">Select Centre…</option>
                {centres.map((centre) => (
                  <option key={centre.id} value={centre.id}>
                    {centre.name}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                AF id (optional)
              </span>
              <Input
                value={addCode}
                onChange={(event) => setAddCode(event.target.value)}
                placeholder="AF123"
                aria-label="AF id"
              />
            </label>
          </div>

          <p className="mt-3 text-xs text-text-muted">
            Centre staff are seat-scoped: program is taken from the centre and
            access follows the seat. AF id can be added later.
          </p>

          {addError && (
            <p className="mt-4 text-sm text-danger" role="alert">
              {addError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitAddUser()}
              disabled={addBusy || !addValid}
            >
              Add User
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
