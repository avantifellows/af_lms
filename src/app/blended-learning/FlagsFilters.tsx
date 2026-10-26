"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition, type ChangeEvent } from "react";

import type { FlagRecipient } from "@/lib/blended-learning-mentee-detail";

import { BlendedSelect } from "./BlendedSelect";
import { FLAG_RECIPIENT } from "./students/[id]/flagRecipients";

// The Flags feed's filters: Mentor (admins only) and Flag Recipient. Changing either one
// applies it straight away: the URL is pushed with the new filters, so the
// view stays shareable and Back/Forward step through filter changes. The
// visit's cutoff (`since`) is carried, so flags stay New all visit, and the
// page cursor is dropped, so the feed starts from the newest flag. While the
// new page loads the selects show the choice (optimistically); once it lands,
// or on Back/Forward, they show the URL's filters again.

export type FlagsFilterValues = {
  // Null for a Mentor's own feed: no Mentor filter.
  mentors: { mentorUserId: number; name: string }[] | null;
  mentorUserId: number | null;
  recipient: FlagRecipient | null;
  since: string;
};

function flagsFilterHref(
  pathname: string,
  since: string,
  filters: { mentor: string; recipient: string }
): string {
  const params = new URLSearchParams({ tab: "flags", since });
  if (filters.mentor) params.set("mentor", filters.mentor);
  if (filters.recipient) params.set("recipient", filters.recipient);
  return `${pathname}?${params}`;
}

export function FlagsFilters({ filters }: { filters: FlagsFilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic({
    mentor: filters.mentorUserId?.toString() ?? "",
    recipient: filters.recipient ?? "",
  });

  function apply(name: "mentor" | "recipient") {
    return (event: ChangeEvent<HTMLSelectElement>) => {
      const next = { ...current, [name]: event.target.value };
      startTransition(() => {
        setCurrent(next);
        router.push(flagsFilterHref(pathname, filters.since, next), { scroll: false });
      });
    };
  }

  return (
    <form
      role="search"
      aria-label="Filter flags"
      aria-busy={pending}
      // Nothing to submit: each select applies itself.
      onSubmit={(event) => event.preventDefault()}
      className="grid gap-3 sm:grid-cols-2"
    >
      {filters.mentors && (
        <label className="block space-y-1 text-sm font-bold text-text-secondary">
          <span>Mentor</span>
          <BlendedSelect name="mentor" value={current.mentor} onChange={apply("mentor")} className="bg-bg-input text-text-primary">
            <option value="">All Mentors</option>
            {filters.mentors.map((mentor) => (
              <option key={mentor.mentorUserId} value={mentor.mentorUserId}>
                {mentor.name}
              </option>
            ))}
          </BlendedSelect>
        </label>
      )}
      <label className="block space-y-1 text-sm font-bold text-text-secondary">
        <span>Flag Recipient</span>
        <BlendedSelect
          name="recipient"
          value={current.recipient}
          onChange={apply("recipient")}
          className="bg-bg-input text-text-primary"
        >
          <option value="">All recipients</option>
          {(Object.keys(FLAG_RECIPIENT) as FlagRecipient[]).map((recipient) => (
            <option key={recipient} value={recipient}>
              {FLAG_RECIPIENT[recipient]}
            </option>
          ))}
        </BlendedSelect>
      </label>
    </form>
  );
}
