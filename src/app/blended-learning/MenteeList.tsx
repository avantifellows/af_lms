import Link from "next/link";
import { ArrowUpRight, MessageCirclePlus } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui";
import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { daysAgo, shortDate, whyNowTags } from "./menteeListCopy";

// The Student list: one table from 1024 px up, with "Talk to first" and
// "Everyone else" as group header rows; a card per Student below that. A
// click anywhere on a row or card opens the Student (the name's link
// stretches over it); the row's own links sit above that link. Each Student
// has a "View" button; Mentors who can log also get "New log", and a ready
// Conversation Draft's chip opens it on the log page. For anyone else
// (admins, read-only users) View is the row's only button and the chip is a
// plain label. `today` is the IST date, so this year's dates drop the year.

export type MenteeGroupView = { title: string; description: string; mentees: MenteeRow[] };

type RowProps = { mentee: MenteeRow; canLog: boolean; today?: string };

function menteeHref(mentee: MenteeRow) {
  return `/blended-learning/students/${mentee.studentId}`;
}

const muted = "font-normal text-text-muted";

export function LastContact({ mentee, today }: { mentee: MenteeRow; today?: string }) {
  if (mentee.lastContact === null) return <span className={muted}>Never</span>;
  const legacy = mentee.lastContactSource === "legacy";
  return (
    <span className="block whitespace-nowrap font-semibold text-text-primary">
      {shortDate(mentee.lastContact, today)}
      <span className={`block text-xs ${muted}`}>
        {legacy || mentee.daysSince === null ? "before app" : daysAgo(mentee.daysSince)}
      </span>
    </span>
  );
}

export function WhyNowTags({ mentee, today }: { mentee: MenteeRow; today?: string }) {
  const tags = whyNowTags(mentee, today);
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <Badge key={tag.reason} variant={tag.tone} className="whitespace-nowrap">
          {tag.text}
        </Badge>
      ))}
    </>
  );
}

function DraftChip({ mentee, canLog, className = "" }: { mentee: MenteeRow; canLog: boolean; className?: string }) {
  if (mentee.openDraftState !== "ready") return null;
  const chip = <Badge variant="accent" className="whitespace-nowrap">Draft ready to review</Badge>;
  if (!canLog) return <span className={`inline-flex items-center ${className}`}>{chip}</span>;
  return (
    <Link href={`${menteeHref(mentee)}/log`} className={`relative z-10 inline-flex items-center ${className}`}>
      {chip}
    </Link>
  );
}

function NameLink({ mentee }: { mentee: MenteeRow }) {
  return (
    <Link
      href={menteeHref(mentee)}
      className="inline-flex min-h-11 items-center font-bold text-text-primary after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4"
    >
      {mentee.name}
    </Link>
  );
}

const actionBase =
  "relative z-10 inline-flex items-center justify-center gap-2 rounded-lg border font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const outlined = `${actionBase} border-border bg-bg-card text-text-primary hover:border-accent hover:bg-hover-bg`;
const primary = `${actionBase} border-accent bg-accent text-text-on-accent hover:bg-accent-hover`;

// Small text buttons, 44 px tall; on a card each takes half the row and the
// icons drop out below 400 px so both labels fit at 360 px. The accessible
// names say which Student.
function RowActions({ mentee, canLog, card }: { mentee: MenteeRow; canLog: boolean; card: boolean }) {
  const size = card ? "min-h-11 flex-1 px-2 text-[13px]" : "min-h-11 px-3 text-sm";
  const iconClass = `h-4 w-4 shrink-0 ${card ? "hidden min-[400px]:block" : ""}`;
  return (
    <>
      <Link href={menteeHref(mentee)} aria-label={`View ${mentee.name}`} className={`${outlined} ${size}`}>
        <ArrowUpRight aria-hidden="true" className={iconClass} />
        <span className="whitespace-nowrap">View</span>
      </Link>
      {canLog && (
        <Link
          href={`${menteeHref(mentee)}/log`}
          aria-label={`New log for ${mentee.name}`}
          className={`${primary} ${size}`}
        >
          <MessageCirclePlus aria-hidden="true" className={iconClass} />
          <span className="whitespace-nowrap">New log</span>
        </Link>
      )}
    </>
  );
}

function orDash(value: string | number | null) {
  return value === null ? "—" : value;
}

// "Not reachable on the last try, … 4 of 12."
function groupSummary(group: MenteeGroupView, total: number): string {
  return `${group.description} ${group.mentees.length} of ${total}.`.trim();
}

const COLUMNS = ["Student", "Why now", "Grade", "Program", "Gender", "Last conversation"];

function GroupHeader({ group, total }: { group: MenteeGroupView; total: number }) {
  return (
    <tr>
      <th
        scope="rowgroup"
        colSpan={COLUMNS.length + 1}
        className="border-t border-border bg-bg px-3.5 pb-2.5 pt-4 text-left text-sm font-normal text-text-muted"
      >
        <span className="mr-2 text-base font-bold text-text-primary">{group.title}</span>
        {groupSummary(group, total)}
      </th>
    </tr>
  );
}

const cell = "px-3 py-2.5 align-middle";

function TableRow({ mentee, canLog, today }: RowProps) {
  return (
    <tr className="relative cursor-pointer border-t border-border hover:bg-hover-bg">
      <td className={`${cell} whitespace-nowrap`}>
        <NameLink mentee={mentee} />
      </td>
      <td className={cell}>
        <span className="flex flex-col items-start gap-1.5">
          <WhyNowTags mentee={mentee} today={today} />
          <DraftChip mentee={mentee} canLog={canLog} className="min-h-11 -my-2.5" />
        </span>
      </td>
      <td className={`${cell} whitespace-nowrap`}>{orDash(mentee.grade)}</td>
      <td className={cell}>{orDash(mentee.programName)}</td>
      <td className={`${cell} whitespace-nowrap`}>{orDash(mentee.gender)}</td>
      <td className={cell}>
        <LastContact mentee={mentee} today={today} />
      </td>
      <td className={`${cell} w-px whitespace-nowrap pr-4`}>
        <span className="flex gap-2">
          <RowActions mentee={mentee} canLog={canLog} card={false} />
        </span>
      </td>
    </tr>
  );
}

type ListProps = { groups: MenteeGroupView[]; total: number; canLog: boolean; today?: string };

function MenteeTable({ groups, total, canLog, today }: ListProps) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm lg:block">
      <table className="w-full text-left text-sm text-text-primary">
        <thead className="text-xs uppercase tracking-wide text-text-muted">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="whitespace-nowrap px-3 py-3 font-bold">
                {column}
              </th>
            ))}
            <th scope="col" className="px-3 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.title} aria-label={group.title}>
            <GroupHeader group={group} total={total} />
            {group.mentees.map((mentee) => (
              <TableRow key={mentee.studentId} mentee={mentee} canLog={canLog} today={today} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function CardField({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</p>
      <div className="text-sm text-text-primary">{children}</div>
    </div>
  );
}

function MenteeCard({ mentee, canLog, today }: RowProps) {
  const hasWhyNow = mentee.reasons.length > 0 || mentee.openDraftState === "ready";
  return (
    <li className="relative grid grid-cols-3 gap-x-3 gap-y-2.5 rounded-xl border border-border bg-bg-card px-4 py-3.5 shadow-sm active:bg-hover-bg">
      <div className="col-span-3 -my-1.5">
        <NameLink mentee={mentee} />
      </div>
      {hasWhyNow && (
        <div className="col-span-3 flex flex-wrap items-center gap-1.5">
          <WhyNowTags mentee={mentee} today={today} />
          <DraftChip mentee={mentee} canLog={canLog} className="min-h-11 -my-2.5" />
        </div>
      )}
      <CardField label="Program" className="col-span-3">{orDash(mentee.programName)}</CardField>
      <CardField label="Grade">{orDash(mentee.grade)}</CardField>
      <CardField label="Gender">{orDash(mentee.gender)}</CardField>
      <CardField label="Last conversation">
        <LastContact mentee={mentee} today={today} />
      </CardField>
      <div className="col-span-3 flex gap-2 pt-1">
        <RowActions mentee={mentee} canLog={canLog} card />
      </div>
    </li>
  );
}

function MenteeCards({ groups, total, canLog, today }: ListProps) {
  return (
    <div className="space-y-5 lg:hidden">
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <div className="mb-2 px-0.5 text-sm text-text-muted">
            <h2 className="mr-2 inline text-base font-bold text-text-primary">{group.title}</h2>
            {groupSummary(group, total)}
          </div>
          <ul className="space-y-2.5">
            {group.mentees.map((mentee) => (
              <MenteeCard key={mentee.studentId} mentee={mentee} canLog={canLog} today={today} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Groups with no Students are left out; `total` is every Student shown.
export function MenteeGroups({ groups, canLog, today }: { groups: MenteeGroupView[]; canLog: boolean; today?: string }) {
  const shown = groups.filter((group) => group.mentees.length > 0);
  const total = shown.reduce((sum, group) => sum + group.mentees.length, 0);
  return (
    <>
      <MenteeTable groups={shown} total={total} canLog={canLog} today={today} />
      <MenteeCards groups={shown} total={total} canLog={canLog} today={today} />
    </>
  );
}
