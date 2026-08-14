"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui";

// Each search is a full server render of the dashboard, so firing one per
// keystroke meant typing "gpuc shim" issued nine of them — and they completed
// out of order, so the list could settle on a stale keystroke's results.
// 300ms is long enough to collapse a burst of typing into one request and short
// enough not to feel laggy.
const SEARCH_DEBOUNCE_MS = 300;

interface SchoolSearchProps {
  defaultValue?: string;
  basePath?: string; // e.g., "/dashboard"
  placeholder?: string;
}

export default function SchoolSearch({
  defaultValue,
  basePath = "/dashboard",
  placeholder = "Search schools by name, code, or district...",
}: SchoolSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(defaultValue || "");

  const handleSearch = useCallback(
    (term: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (term) {
        params.set("q", term);
      } else {
        params.delete("q");
      }
      startTransition(() => {
        router.push(`${basePath}?${params.toString()}`);
      });
    },
    [router, searchParams, basePath]
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (term: string) => {
      // Keep the input responsive immediately; defer only the navigation.
      setValue(term);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => handleSearch(term), SEARCH_DEBOUNCE_MS);
    },
    [handleSearch]
  );

  // Don't leave a pending navigation behind on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <svg
          className={`h-5 w-5 ${isPending ? "text-accent" : "text-gray-400"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <Input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter skips the debounce for anyone who types then hits return.
          if (e.key === "Enter") {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            handleSearch(value);
          }
        }}
        placeholder={placeholder}
        className="pl-10 pr-4"
      />
      {isPending && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}
    </div>
  );
}
