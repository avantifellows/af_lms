"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { FoundAlumnus } from "@/lib/alumni/students";

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
    <section className="mb-6 rounded-lg bg-white p-4 shadow">
      <label htmlFor="find-alumnus" className="mb-2 block text-sm font-medium text-gray-900">
        Find an alumnus
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          id="find-alumnus"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or AFID"
          autoComplete="off"
          className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
      <Results state={state} />
    </section>
  );
}

function Results({ state }: { state: State }) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") return <p className="mt-3 text-sm text-gray-500">Searching…</p>;
  if (state.kind === "error") return <p className="mt-3 text-sm text-red-600">{state.message}</p>;
  if (!state.results.length) return <p className="mt-3 text-sm text-gray-500">No alumni found.</p>;
  return (
    <ul className="mt-3 divide-y divide-gray-100" aria-label="Alumni found">
      {state.results.map((a) => (
        <li key={a.alumniId}>
          <Link
            href={`/alumni/record/${encodeURIComponent(a.alumniId)}`}
            className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 hover:bg-gray-50"
          >
            <span>
              <span className="font-medium text-gray-900">{a.name}</span>
              {a.afid && <span className="ml-2 font-mono text-xs text-gray-500">{a.afid}</span>}
            </span>
            <span className="text-sm text-gray-600">
              {a.schoolName || "No school on record"}
              {a.cohortYear && ` · cohort ${a.cohortYear}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
