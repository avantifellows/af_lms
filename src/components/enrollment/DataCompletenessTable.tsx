"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { Button, Card } from "@/components/ui";
import {
  severityFor,
  type CompletenessFilterKey,
  type CompletenessGroup,
  type CompletenessItem,
  type DataCompleteness,
} from "@/lib/data-completeness";

interface Props {
  completeness: DataCompleteness;
  /** The chip or group label the roster is narrowed by, if any. */
  activeFilter: CompletenessFilterKey | null;
  onFilterChange: (key: CompletenessFilterKey | null) => void;
  /** Wording for the active filter, e.g. "Missing Address". */
  activeFilterLabel: string | null;
  /** Students the active filter matches. */
  filteredCount: number;
  /** "students" or "Grade 11 students" — follows the grade filter. */
  scopeNoun: string;
  /** The documents read failed; the Documents row says so instead of counting. */
  documentsError?: boolean;
}

// Count-pill colours. Red from half the Students up, amber from a fifth — the
// same thresholds the roster's own severity tokens use elsewhere.
const SEVERITY_CLASSES = {
  high: "bg-danger-bg text-danger",
  medium: "bg-warning-bg text-warning-text",
  low: "bg-bg-card-alt text-text-muted",
} as const;

function meterToneClass(pct: number): string {
  if (pct < 50) return "bg-danger";
  if (pct < 80) return "bg-warning-text";
  return "bg-success";
}

function percentToneClass(pct: number): string {
  if (pct < 50) return "text-danger";
  if (pct < 80) return "text-warning-text";
  return "text-success";
}

function MissingChip({
  item,
  pressed,
  onToggle,
}: {
  item: CompletenessItem;
  pressed: boolean;
  onToggle: () => void;
}) {
  const severity = severityFor(item.missing, item.expected);
  // The lock and the star are decoration, and the count sits in its own span,
  // so the name is spelled out rather than left to read as "Address3".
  const description = `${item.missing} of ${item.expected} students missing ${item.label}`;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      aria-label={description}
      title={description}
      className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        pressed
          ? "border-danger bg-danger text-text-on-accent shadow-sm"
          : "border-border bg-bg-card text-text-primary hover:border-accent/50"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {item.locked && <Lock className="h-3 w-3" aria-hidden="true" />}
        {item.label}
        {item.required && (
          <span
            aria-hidden="true"
            className={pressed ? "text-text-on-accent" : "text-danger"}
          >
            *
          </span>
        )}
      </span>
      <span
        className={`rounded-full px-1.5 font-mono text-[11px] font-bold ${
          pressed ? "bg-bg-card text-danger" : SEVERITY_CLASSES[severity]
        }`}
      >
        {item.missing}
      </span>
    </button>
  );
}

function GroupRow({
  group,
  activeFilter,
  onFilterChange,
  documentsError,
  withRule,
}: {
  group: CompletenessGroup;
  activeFilter: CompletenessFilterKey | null;
  onFilterChange: (key: CompletenessFilterKey | null) => void;
  documentsError?: boolean;
  withRule: boolean;
}) {
  const groupKey = `group:${group.key}`;
  const groupPressed = activeFilter === groupKey;
  const toggle = (key: CompletenessFilterKey) =>
    onFilterChange(activeFilter === key ? null : key);
  const errored = group.key === "documents" && documentsError === true;
  // Nothing to show: the first read failed, or none has landed yet. A failed
  // *re*fetch keeps the Students' documents it already had, so that row still
  // counts — it only says the numbers may be a save behind.
  const unanswered = group.pending;
  const failed = errored && unanswered;
  const stale = errored && !unanswered;
  // Until the row has an answer, "missing any document" would match nobody,
  // which reads as "nobody is missing one"; and an empty first read would
  // match everybody. Neither is true, so the label doesn't invite the tap.
  const groupDisabled = unanswered;

  return (
    <div
      data-testid={`completeness-row-${group.key}`}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 ${
        withRule ? "border-b border-border" : ""
      }`}
    >
      <button
        type="button"
        aria-pressed={groupPressed}
        onClick={() => toggle(groupKey)}
        disabled={groupDisabled}
        title={
          groupDisabled
            ? `${group.title} are still being read`
            : `Show students missing any ${group.title.toLowerCase()}`
        }
        className={`inline-flex min-h-[32px] w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors disabled:cursor-not-allowed sm:w-44 ${
          groupPressed ? "bg-danger-bg ring-1 ring-danger" : "hover:bg-bg-card-alt"
        } ${groupDisabled ? "hover:bg-transparent" : ""}`}
      >
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
          {group.title}
        </span>
        {!group.pending && !failed && (
          <>
            <span
              className={`font-mono text-xs font-bold ${percentToneClass(group.pct)}`}
            >
              {group.pct}%
            </span>
            <span
              aria-hidden="true"
              className="h-1 w-10 overflow-hidden rounded-full bg-bg-card-alt"
            >
              <span
                className={`block h-full ${meterToneClass(group.pct)}`}
                style={{ width: `${group.pct}%` }}
              />
            </span>
          </>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {failed ? (
          <span className="text-xs text-text-muted">
            Documents couldn&apos;t be loaded. Reload to try again.
          </span>
        ) : group.pending ? (
          <span className="text-xs text-text-muted">Loading documents…</span>
        ) : (
          <>
            {group.items.map((item) => (
              <MissingChip
                key={item.key}
                item={item}
                pressed={activeFilter === item.key}
                onToggle={() => toggle(item.key)}
              />
            ))}
            {group.complete.length > 0 && (
              <span
                title={group.complete.join(", ")}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-success/30 bg-success-bg px-2.5 py-1 text-xs text-success"
              >
                ✓ {group.complete.length} complete
              </span>
            )}
            {group.items.length === 0 && group.complete.length === 0 && (
              <span className="text-xs text-text-muted">Nothing to track yet</span>
            )}
            {group.notes.map((note) => (
              <span key={note} className="text-xs italic text-text-muted">
                {note}
              </span>
            ))}
            {stale && (
              <span className="text-xs italic text-text-muted">
                Couldn&apos;t refresh — a recent upload may be missing here.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The Enrollment tab's Data completeness table (#468): one row per group, one
 * chip per item, each counting the Students in scope who are missing it.
 * Tapping a chip (or a group label) narrows the roster below to exactly those
 * Students — the counts and the list come from the same rule, in
 * `lib/data-completeness.ts`.
 *
 * Physical centres only; JNV NVS keeps its Admission row instead.
 */
export default function DataCompletenessTable({
  completeness,
  activeFilter,
  onFilterChange,
  activeFilterLabel,
  filteredCount,
  scopeNoun,
  documentsError = false,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { total, groups } = completeness;

  return (
    <Card elevation="md" className="mb-6 p-5" data-testid="data-completeness">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold text-text-primary">
          Data completeness
        </h2>
        {!collapsed && (
          <p className="flex flex-wrap items-center gap-x-3 text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" aria-hidden="true" /> Locked
            </span>
            <span>
              <span className="text-danger">*</span> Required
            </span>
            <span>Count = students missing</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((open) => !open)}
          aria-expanded={!collapsed}
          className="ml-auto inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-xs font-medium text-text-muted hover:text-text-primary"
        >
          {collapsed ? "Show" : "Hide"}
          {collapsed ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {!collapsed && total === 0 && (
        <p className="mt-3 text-sm text-text-muted">
          No students in this view — nothing to measure.
        </p>
      )}

      {!collapsed && total > 0 && (
        <div className="mt-1">
          {groups.map((group, index) => (
            <GroupRow
              key={group.key}
              group={group}
              activeFilter={activeFilter}
              onFilterChange={onFilterChange}
              documentsError={documentsError}
              withRule={index < groups.length - 1}
            />
          ))}
        </div>
      )}

      {activeFilter && (
        <div
          data-testid="completeness-filter-bar"
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-danger-bg px-3 py-2 text-sm"
        >
          <span className="font-medium text-text-primary">
            {activeFilterLabel ?? "Filtered"}
          </span>
          <span className="text-text-muted">·</span>
          <span className="font-mono text-text-primary">
            {filteredCount} of {total} {scopeNoun}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => onFilterChange(null)}
          >
            Clear
          </Button>
        </div>
      )}
    </Card>
  );
}
