"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

import { Card } from "@/components/ui";
import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { LastContact, WhyNowTags } from "../../../MenteeList";
import { savedRows, type Saved } from "./savedSummary";

// Shown in place of the form once the entry is saved: what was saved, row by
// row, then what the Student list now says about this Mentee.

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-right font-bold text-text-primary">{children}</dd>
    </div>
  );
}

function ListRows({ mentee }: { mentee: MenteeRow }) {
  return (
    <>
      <Row label="Last contact">
        <LastContact mentee={mentee} />
      </Row>
      {mentee.reasons.length > 0 && (
        <Row label="Why now">
          <WhyNowTags mentee={mentee} />
        </Row>
      )}
    </>
  );
}

export function SavedConfirmation({
  saved,
  studentId,
  name,
  firstName,
  forOwnList,
}: {
  saved: Saved;
  studentId: number;
  name: string;
  firstName: string;
  forOwnList: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The form is gone; move focus to what replaced it.
  useEffect(() => headingRef.current?.focus(), []);
  const { entry, mentee } = saved;
  const group = mentee && mentee.reasons.length > 0 ? "Talk to first" : "Everyone else";
  return (
    <section aria-label="Saved">
      <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-text-primary focus:outline-none">
          {entry.kind === "conversation" ? "Conversation saved" : "Attempt logged"}
        </h2>
        {mentee && (
          <p className="text-sm text-text-secondary">
            {`${forOwnList ? "Your" : "The"} student list now shows ${name} in ${group}.`}
          </p>
        )}
        <dl className="divide-y divide-border border-y border-border text-sm">
          {savedRows(entry).map((row) => (
            <Row key={row.label} label={row.label}>
              {row.value}
            </Row>
          ))}
          {mentee && <ListRows mentee={mentee} />}
        </dl>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/blended-learning/students/${studentId}`}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-text-on-accent shadow-sm hover:bg-accent-hover"
          >
            {`View ${firstName}'s history`}
          </Link>
          <Link
            href="/blended-learning"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-bg-card px-4 text-sm font-bold text-text-primary shadow-sm hover:bg-hover-bg"
          >
            Back to students
          </Link>
        </div>
      </Card>
    </section>
  );
}
