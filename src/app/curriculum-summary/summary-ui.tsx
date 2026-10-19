// Presentational pieces shared by the Curriculum Summary and the chapter timeline. Server
// components only: no hooks, no server-only imports.

import Link from "next/link";
import type { ReactNode } from "react";

import { Card, type BadgeVariant } from "@/components/ui";
import type { BehindPillTone } from "@/lib/curriculum-plan-rules";

export const TONE_BADGE_VARIANTS: Record<BehindPillTone, BadgeVariant> = {
  green: "success",
  amber: "warning",
  red: "danger",
};

export const PAGE_CONTAINER_CLASS_NAME = "w-full px-4 py-3 sm:px-6 lg:px-8";

const FIELD_LABEL_CLASS_NAME =
  "flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-text-muted";
const FIELD_CLASS_NAME =
  "min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal normal-case text-text-primary";
const BUTTON_CLASS_NAME =
  "min-h-[44px] rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover";

export function HeaderNumber({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card elevation="sm" className="p-3 sm:p-4">
      <span className="block text-xs uppercase tracking-wider text-text-muted">{label}</span>
      <span data-testid={testId} className="mt-1 block font-mono text-2xl font-bold text-text-primary">
        {value}
      </span>
    </Card>
  );
}

export function SchemaUnavailableCard({
  error,
  details,
  children,
}: {
  error: string;
  details: string[];
  children?: ReactNode;
}) {
  return (
    <Card className="border-l-4 border-l-warning-border p-6">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
          Schema unavailable
        </p>
        <h2 className="text-lg font-bold text-text-primary">{error}</h2>
        {children}
        <ul className="list-disc space-y-1 pl-5 font-mono text-sm text-text-secondary">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export interface SegmentLink {
  key: string;
  label: string;
  href: string;
  active: boolean;
  // Shown as plain text with this title instead of a link.
  disabledTitle?: string;
}

// A labelled row of toggle links (Grade, Hours window); the active one is the current page.
export function SegmentLinks({
  label,
  navLabel,
  links,
}: {
  label: string;
  navLabel: string;
  links: SegmentLink[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-wide text-text-muted">{label}</span>
      <nav aria-label={navLabel} className="flex gap-1">
        {links.map((link) =>
          link.disabledTitle ? (
            <span
              key={link.key}
              aria-disabled="true"
              title={link.disabledTitle}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text-muted"
            >
              {link.label}
            </span>
          ) : (
            <Link
              key={link.key}
              href={link.href}
              aria-current={link.active ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm font-bold ${
                link.active
                  ? "border-accent bg-accent text-white"
                  : "border-border text-accent hover:text-accent-hover"
              }`}
            >
              {link.label}
            </Link>
          )
        )}
      </nav>
    </div>
  );
}

export function AsOfField({ asOf }: { asOf: string }) {
  return (
    <label className={FIELD_LABEL_CLASS_NAME}>
      As of
      <input type="date" name="as_of" defaultValue={asOf} className={FIELD_CLASS_NAME} />
    </label>
  );
}

export function ApplyButton() {
  return (
    <button type="submit" className={BUTTON_CLASS_NAME}>
      Apply
    </button>
  );
}

const HEADER_TEXT_CLASS_NAME = "py-3 text-xs font-bold uppercase tracking-wide text-text-muted";
const TABLE_HEADER_CLASS_NAME = `px-4 text-left ${HEADER_TEXT_CLASS_NAME}`;

export function TableHead({ headers }: { headers: readonly string[] }) {
  return (
    <thead className="bg-bg-muted">
      <tr>
        {headers.map((header) => (
          <th key={header} scope="col" className={TABLE_HEADER_CLASS_NAME}>
            {header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export interface SortableHeader {
  label: string;
  // The link that sorts by this column.
  href: string;
  // Set on the column the table is sorted by.
  direction: "asc" | "desc" | null;
  // The column's width, padding and alignment; default `px-4 text-left`.
  className?: string;
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

// A table head whose every header is a sort link; the sorted column shows ▲ / ▼ and `aria-sort`.
export function SortableTableHead({ headers }: { headers: readonly SortableHeader[] }) {
  return (
    <thead className="bg-bg-muted">
      <tr>
        {headers.map((header) => (
          <th
            key={header.label}
            scope="col"
            aria-sort={header.direction ? ARIA_SORT[header.direction] : undefined}
            className={`${header.className ?? "px-4 text-left"} ${HEADER_TEXT_CLASS_NAME}`}
          >
            <Link
              href={header.href}
              className={`inline-flex items-center gap-1 hover:text-accent-hover ${
                header.direction ? "text-text-primary" : ""
              }`}
            >
              {header.label}
              {header.direction ? (
                <span aria-hidden="true">{header.direction === "asc" ? "▲" : "▼"}</span>
              ) : null}
            </Link>
          </th>
        ))}
      </tr>
    </thead>
  );
}

// Optional hidden form field: omitted when there is no value to carry.
export function HiddenField({ name, value }: { name: string; value: string | number | null }) {
  return value === null ? null : <input type="hidden" name={name} value={value} />;
}
