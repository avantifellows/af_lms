"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { FoundAlumnus } from "@/lib/alumni/students";

/** Same as the API's MAX_FIND_LENGTH (a type-only import keeps server code out of the bundle). */
const MAX_LENGTH = 100;

// "Find an alumnus" on the Alumni home: by AFID or name, across every school
// in the person's scope. Reaches alumni who are in no school's list (many
// bulk-imported records have no School on record).

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 300;

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; results: FoundAlumnus[] }
  | { kind: "error"; message: string };

async function fetchResults(q: string): Promise<State> {
  try {
    const res = await fetch(`/api/alumni/find?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    if (!res.ok) return { kind: "error", message: body?.error || "Couldn't search alumni." };
    return { kind: "done", results: body.results ?? [] };
  } catch {
    return { kind: "error", message: "Couldn't search alumni. Check your connection." };
  }
}

/**
 * Debounced search; a newer query wins over a slower older one. Only finished
 * answers are stored: "idle" and "loading" follow from the query itself.
 */
function useFind(q: string): State {
  const text = q.trim();
  const [answer, setAnswer] = useState<{ q: string; state: State } | null>(null);
  useEffect(() => {
    if (text.length < MIN_LENGTH) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const state = await fetchResults(text);
      if (!cancelled) setAnswer({ q: text, state });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text]);
  if (text.length < MIN_LENGTH) return { kind: "idle" };
  return answer?.q === text ? answer.state : { kind: "loading" };
}

export default function FindAlumnus() {
  const [q, setQ] = useState("");
  const state = useFind(q);
  return (
    <section className="mb-6 rounded-xl border border-border bg-bg-card p-4 shadow-sm">
      <label htmlFor="find-alumnus" className="mb-2 block text-sm font-bold uppercase tracking-wide text-text-primary">
        Find an alumnus
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <input
          id="find-alumnus"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or AFID"
          autoComplete="off"
          maxLength={MAX_LENGTH}
          className="w-full rounded-md border border-border bg-bg-card py-2 pl-9 pr-3 text-sm text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      <Results state={state} />
    </section>
  );
}

function Results({ state }: { state: State }) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") return <p className="mt-3 text-sm text-text-muted">Searching…</p>;
  if (state.kind === "error") return <p className="mt-3 text-sm text-danger">{state.message}</p>;
  if (!state.results.length) return <p className="mt-3 text-sm text-text-muted">No alumni found.</p>;
  return (
    <ul className="mt-3 divide-y divide-border" aria-label="Alumni found">
      {state.results.map((a) => (
        <li key={a.alumniId}>
          <Link
            href={`/alumni/record/${encodeURIComponent(a.alumniId)}`}
            className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 hover:bg-hover-bg"
          >
            <span>
              <span className="font-medium text-text-primary">{a.name}</span>
              {a.afid && <span className="ml-2 font-mono text-xs text-text-muted">{a.afid}</span>}
            </span>
            <span className="text-sm text-text-secondary">
              {a.schoolName || "No school on record"}
              {a.cohortYear && ` · cohort ${a.cohortYear}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
