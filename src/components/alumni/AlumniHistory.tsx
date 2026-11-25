"use client";

import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui";
import type { Values } from "@/lib/alumni/fields";

// An alumnus's history (alumni_journey), like a sheet's version history: a
// panel on the right lists every save; picking one shows the whole form as it
// was then (AlumniForm), from where it can be restored. A restore adds a new
// "Correction" version — nothing is lost.

export interface JourneyChange {
  column: string;
  label: string;
  before: string;
  after: string;
}

export interface JourneyEntry {
  id: string;
  reportedOn: string;
  /** When the row was saved (ISO, UTC); history is in this order. */
  recordedAt: string;
  source: "initial" | "call" | "form" | "bulk_upload" | "correction";
  recordedBy: string;
  notes: string;
  changes: JourneyChange[];
  matchesCurrent: boolean;
  /** The whole record as of this version, as form values. */
  values: Values;
  names: Record<string, string>;
}

export const SOURCES: Record<JourneyEntry["source"], { label: string; variant: BadgeVariant }> = {
  initial: { label: "Starting record", variant: "default" },
  call: { label: "Call", variant: "info" },
  form: { label: "Form", variant: "info" },
  bulk_upload: { label: "Bulk edit", variant: "warning" },
  correction: { label: "Correction", variant: "accent" },
};

export type JourneyState = { entries: JourneyEntry[]; error: string } | null;

/** The history, loaded again after every save or restore (`reloadKey`); null while off or not wanted. */
export function useJourney(alumniId: string | null, reloadKey: number): JourneyState {
  const [state, setState] = useState<JourneyState>(null);
  useEffect(() => {
    if (!alumniId) return;
    let live = true;
    fetch(`/api/alumni/${encodeURIComponent(alumniId)}/journey`)
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (!r.ok) setState({ entries: [], error: body.error ?? "Couldn't load the history." });
        else setState(body.enabled ? { entries: body.entries, error: "" } : null);
      })
      .catch(() => live && setState({ entries: [], error: "Couldn't load the history." }));
    return () => {
      live = false;
    };
  }, [alumniId, reloadKey]);
  return alumniId ? state : null;
}

const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
export const formatDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", DATE);
/** "23 Nov 2026, 4:12 pm" in India, for a moment (ISO). */
export const formatMoment = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { ...DATE, hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
/** The day a row was saved, in India. */
const formatRecorded = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { ...DATE, timeZone: "Asia/Kolkata" });

/** Puts the record back to `entry`: the fields it restored, or the error to show. */
export async function restoreVersion(
  alumniId: string,
  entry: JourneyEntry,
  version: string,
): Promise<{ error: string } | { changed: string[] }> {
  try {
    const r = await fetch(`/api/alumni/${encodeURIComponent(alumniId)}/journey/revert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journeyId: entry.id, version }),
    });
    const body = await r.json();
    return r.ok ? { changed: body.changed } : { error: body.error ?? "Couldn't restore." };
  } catch {
    return { error: "Couldn't restore. Check your connection and try again." };
  }
}

/** The button that opens the panel; none while there's no history to show (`count` null). */
export function HistoryButton({ count, onClick }: { count: number | null; onClick: () => void }) {
  if (count === null) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-card px-3 py-1.5 text-sm font-semibold text-text-primary shadow-sm hover:bg-hover-bg"
    >
      <History className="h-4 w-4 text-text-muted" aria-hidden />
      History
      <span className="font-normal text-text-muted">· {count}</span>
    </button>
  );
}

interface PanelProps {
  journey: NonNullable<JourneyState>;
  /** The version shown in the form; null = the current record. */
  selectedId: string | null;
  onSelect: (entry: JourneyEntry | null) => void;
  onClose: () => void;
}


/** Open side panels and their widths (rem); the page makes room for the widest. */
const roomTakers = new Map<symbol, number>();
/** The page's own right padding, from before the first panel opened. */
let paddingBefore = "";

function applyRoom() {
  const widest = Math.max(0, ...roomTakers.values());
  document.body.style.paddingRight = widest ? `${widest}rem` : paddingBefore;
}

/**
 * While the panel is open on a wider screen, the page makes room for it (like
 * a sheet's version history) instead of being covered. Panels can be open at
 * once (an alumnus's and the school's); the room fits the widest still open,
 * and the page gets its padding back when the last one closes. A form in a
 * modal is fixed in place, so there the panel lies over the modal's right side.
 */
export function useMakeRoom(rem = 24) {
  useEffect(() => {
    // Only where the page can spare the width (on tablets the panel just lies over it).
    if (!window.matchMedia?.("(min-width: 1024px)").matches) return;
    const key = Symbol("panel");
    if (!roomTakers.size) paddingBefore = document.body.style.paddingRight;
    roomTakers.set(key, rem);
    applyRoom();
    return () => {
      roomTakers.delete(key);
      applyRoom();
    };
  }, [rem]);
}

/** The version list, on the right of the screen (full screen on a phone). */
export default function HistoryPanel({ journey, selectedId, onSelect, onClose }: PanelProps) {
  useMakeRoom();
  return (
    <aside
      role="dialog"
      aria-label="Version history"
      className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-border bg-bg-card shadow-2xl sm:max-w-sm"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <History className="h-4 w-4 text-text-muted" aria-hidden />
        <h2 className="font-bold text-text-primary">Version history</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
          className="ml-auto rounded-md p-1.5 text-text-muted hover:bg-hover-bg"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {journey.error && <p className="px-1 text-sm text-danger">{journey.error}</p>}
        {!journey.error && !journey.entries.length && (
          <p className="px-1 text-sm text-text-muted">No history yet. It starts with the next save.</p>
        )}
        <ol className="space-y-1.5">
          {journey.entries.map((entry, i) => (
            <VersionItem
              key={entry.id}
              entry={entry}
              latest={i === 0 && entry.matchesCurrent}
              selected={i === 0 ? selectedId === null : selectedId === entry.id}
              onClick={() => onSelect(i === 0 ? null : entry)}
            />
          ))}
        </ol>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-text-muted">
        Pick a version to see the whole record as it was. Restoring keeps every version.
      </p>
    </aside>
  );
}

interface ItemProps {
  entry: JourneyEntry;
  latest: boolean;
  selected: boolean;
  onClick: () => void;
}

function VersionItem({ entry, latest, selected, onClick }: ItemProps) {
  const source = SOURCES[entry.source] ?? SOURCES.form;
  const late = entry.recordedAt && formatRecorded(entry.recordedAt) !== formatDate(entry.reportedOn);
  const changed = entry.changes.map((c) => c.label);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
          selected ? "border-accent bg-hover-bg" : "border-transparent hover:bg-bg-card-alt"
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-text-primary">{formatDate(entry.reportedOn)}</span>
          <Badge variant={source.variant}>{source.label}</Badge>
          {latest && <Badge variant="success">Current</Badge>}
        </div>
        {late && <p className="mt-0.5 text-[11px] text-text-muted">logged {formatRecorded(entry.recordedAt)}</p>}
        <p className="mt-0.5 truncate text-xs text-text-muted">{entry.recordedBy || "—"}</p>
        {entry.notes && <p className="mt-1 text-xs text-text-secondary">“{entry.notes}”</p>}
        <p className="mt-1 text-xs text-text-secondary">{summary(entry, changed)}</p>
      </button>
    </li>
  );
}

function summary(entry: JourneyEntry, changed: string[]): string {
  if (changed.length) return `Changed: ${changed.join(", ")}`;
  return entry.source === "initial" ? "The record as it was first saved" : "No field changed";
}
