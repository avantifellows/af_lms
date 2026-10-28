"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface SearchableMultiSelectOption {
  value: string;
  label: string;
}

interface SearchableMultiSelectProps {
  label: string;
  options: SearchableMultiSelectOption[];
  selected: string[];
  allLabel: string;
  pluralNoun: string;
  onChange: (selected: string[]) => void;
}

function buttonText(
  options: SearchableMultiSelectOption[],
  selected: string[],
  allLabel: string,
  pluralNoun: string,
): string {
  if (selected.length === 0) return allLabel;
  if (selected.length > 1) return `${selected.length} ${pluralNoun}`;
  return options.find((option) => option.value === selected[0])?.label ?? selected[0];
}

// Selected options first, each group in the given order. Taken once when the list opens, so an
// option doesn't jump away from the pointer when it is ticked.
function selectedFirst(options: SearchableMultiSelectOption[], selected: string[]): string[] {
  const isSelected = (option: SearchableMultiSelectOption) => selected.includes(option.value);
  return [
    ...options.filter(isSelected),
    ...options.filter((option) => !isSelected(option)),
  ].map((option) => option.value);
}

export function SearchableMultiSelect({
  label,
  options,
  selected,
  allLabel,
  pluralNoun,
  onChange,
}: SearchableMultiSelectProps) {
  const labelId = useId();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [openOrder, setOpenOrder] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const open = openOrder !== null;
  const optionsByValue = new Map(options.map((option) => [option.value, option]));
  const needle = search.trim().toLowerCase();
  const listed = (openOrder ?? [])
    .map((value) => optionsByValue.get(value))
    .filter((option): option is SearchableMultiSelectOption => Boolean(option))
    .filter((option) => option.label.toLowerCase().includes(needle));

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Close when the pointer goes down outside. Focus moving out by keyboard is handled on blur.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenOrder(null);
      setSearch("");
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function close(restoreFocus: boolean) {
    setOpenOrder(null);
    setSearch("");
    if (restoreFocus) buttonRef.current?.focus();
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (open && next && !event.currentTarget.contains(next)) close(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }

  function toggleOption(value: string) {
    onChange(selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]);
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-labelledby={labelId}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="relative min-w-0"
    >
      <span id={labelId} className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : setOpenOrder(selectedFirst(options, selected)))}
        className="mt-1 flex w-full items-center justify-between gap-2 border border-border bg-bg-card px-2.5 py-1 text-left text-sm text-text-primary"
      >
        <span className="truncate">{buttonText(options, selected, allLabel, pluralNoun)}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={listId}
          className="absolute left-0 z-20 mt-1 w-72 max-w-[90vw] border border-border bg-bg-card shadow-lg"
        >
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              type="search"
              aria-label={`Search ${label}`}
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full border border-border bg-bg-card px-2 py-1 text-sm text-text-primary"
            />
          </div>
          {listed.length === 0 && (
            <p className="px-3 py-2 text-sm text-text-muted">No matches</p>
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            {listed.map((option) => (
              <li key={option.value}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-hover-bg">
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={() => toggleOption(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
