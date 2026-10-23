"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui";

interface Option {
  code: string;
  name: string;
  meta: string;
}

interface Props {
  kind: "college" | "branch";
  id: string;
  code: string;
  name: string;
  onChange: (code: string, name: string) => void;
}

/** Search-and-pick for a college or branch. Stores the code (C-xxxx / branch_id). */
export default function ReferencePicker({ kind, id, code, name, onChange }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Option[]>([]);
  const [status, setStatus] = useState("");
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onQueryChange(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    const text = value.trim();
    const rid = ++requestId.current;
    if (text.length < 2) {
      setResults([]);
      setStatus("");
      return;
    }
    timer.current = setTimeout(async () => {
      setStatus("Searching…");
      try {
        const res = await fetch(`/api/alumni/search/${kind}?q=${encodeURIComponent(text)}`);
        const body = await res.json();
        if (rid !== requestId.current) return;
        if (!res.ok) throw new Error(body.error || "Search failed");
        setResults(body.results);
        setStatus(body.results.length ? "" : `No ${kind} matches. Try fewer or different words.`);
      } catch (err) {
        if (rid !== requestId.current) return;
        setResults([]);
        setStatus(err instanceof Error ? err.message : "Search failed");
      }
    }, 250);
  }

  function pick(option: Option) {
    onChange(option.code, option.name);
    setQ("");
    setResults([]);
    setStatus("");
  }

  return (
    <div>
      {code ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-bg-card-alt px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-text-primary">{name || "(name not found)"}</span>
            <span className="text-xs text-text-muted">{code}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange("", "")}
            className="rounded p-1 text-text-muted hover:bg-hover-bg hover:text-danger"
            aria-label={`Clear ${kind}`}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input
          id={id}
          className="pl-9"
          placeholder={code ? `Change ${kind}…` : kind === "college" ? "Search college — e.g. nit surathkal, dtu" : "Search branch — e.g. cse, ece, vlsi"}
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          autoComplete="off"
        />
      </div>
      {status && <p className="mt-1 text-xs text-text-muted">{status}</p>}
      {results.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-bg-input shadow-sm">
          {results.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-hover-bg"
              >
                <span className="block text-text-primary">{r.name}</span>
                <span className="text-xs text-text-muted">{[r.code, r.meta].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
