// Presentational pieces shared by the Curriculum Summary and the chapter timeline. Server
// components only: no hooks, no server-only imports.

import Link from "next/link";
import type { ReactNode } from "react";

import { PAGE_TITLE_CLASS } from "@/components/PageHeader";
import { Card, type BadgeVariant } from "@/components/ui";
import type { BehindPillTone } from "@/lib/curriculum-plan-rules";
import PageGuide from "./PageGuide";

export const TONE_BADGE_VARIANTS: Record<BehindPillTone, BadgeVariant> = {
  green: "success",
  amber: "warning",
  red: "danger",
};

// A pill tone as text on a plain background (the selected subject tab, the header cards).
export const TONE_TEXT_CLASS_NAMES: Record<BehindPillTone, string> = {
  green: "text-success",
  amber: "text-warning-text",
  red: "text-danger",
};

// The Summary pill's tinted colours (the Badge success / warning / danger variants) for a pill
// drawn larger than a Badge, such as the timeline's syllabus status cards.
export const TONE_PILL_CLASS_NAMES: Record<BehindPillTone, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-warning-bg text-warning-text",
  red: "bg-danger-bg text-danger",
};

// Header cards: two per row on phones, three from `sm`, and all on one row from `xl`.
export const HEADER_GRID_CLASS_NAME = "grid grid-cols-2 gap-3 sm:grid-cols-3";
export const HEADER_LABEL_CLASS_NAME = "block text-xs uppercase tracking-wider text-text-muted";
export const HEADER_DETAIL_CLASS_NAME = "block text-xs text-text-muted";

export const PAGE_CONTAINER_CLASS_NAME = "w-full px-4 py-3 sm:px-6 lg:px-8";

// Table layout shared by the Summary and the chapter timeline (curriculum owner feedback): key
// columns are wide and centred, the rest compact. Table cells ignore max-width, so width caps sit
// on the cell contents.
export const CELL_CLASS_NAME = "py-3 align-top";
export const COMPACT_CELL_CLASS_NAME = `${CELL_CLASS_NAME} px-2 text-xs leading-5`;
// A number cell: centred, never wrapping, in the Summary's number font.
export const NUMBER_CELL_CLASS_NAME = `${CELL_CLASS_NAME} whitespace-nowrap px-2 text-center font-mono`;
// Header classes: a narrow centred number column, and a compact left-aligned one.
export const NUMBER_COLUMN_CLASS_NAME = "w-20 px-2 text-center";
export const COMPACT_COLUMN_CLASS_NAME = "px-2 text-left";

const FIELD_LABEL_CLASS_NAME =
  "flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-text-muted";
const FIELD_CLASS_NAME =
  "min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal normal-case text-text-primary";
const BUTTON_CLASS_NAME =
  "min-h-[44px] rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover";

// A header card: label, a large value and an optional small grey line under it.
export function HeaderNumber({
  label,
  value,
  testId,
  detail,
}: {
  label: string;
  value: string;
  testId: string;
  detail?: { text: string; testId: string };
}) {
  return (
    <Card elevation="sm" className="p-3 sm:p-4">
      <span className={HEADER_LABEL_CLASS_NAME}>{label}</span>
      <span data-testid={testId} className="mt-1 block font-mono text-2xl font-bold text-text-primary">
        {value}
      </span>
      {detail ? (
        <span data-testid={detail.testId} className={`mt-1 ${HEADER_DETAIL_CLASS_NAME}`}>
          {detail.text}
        </span>
      ) : null}
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

type SortDirection = keyof typeof ARIA_SORT;

export interface SortableColumn<K extends string> {
  label: string;
  sortKey: K;
  className?: string;
}

// Every header links to its sort: the sorted column's link reverses its direction, any other
// column's starts in its first-click direction. `href` builds the link, keeping the page's params.
export function sortableHeaders<K extends string>(
  columns: readonly SortableColumn<K>[],
  sort: { key: K; dir: SortDirection } | null,
  firstDirection: (key: K) => SortDirection,
  href: (sort: { key: K; dir: SortDirection }) => string
): SortableHeader[] {
  return columns.map(({ label, sortKey: key, className }) => {
    const direction = sort?.key === key ? sort.dir : null;
    const nextDirection = direction ? (direction === "asc" ? "desc" : "asc") : firstDirection(key);
    return { label, direction, className, href: href({ key, dir: nextDirection }) };
  });
}

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

// A page title with its ⓘ "How to read this page" guide beside it (PageHeader's `titleBlock`).
export function TitleWithGuide({ title, guide }: { title: string; guide: readonly string[] }) {
  return (
    <div className="flex items-center gap-2">
      <h1 className={`${PAGE_TITLE_CLASS} min-w-0 break-words`}>{title}</h1>
      <PageGuide items={guide} />
    </div>
  );
}
