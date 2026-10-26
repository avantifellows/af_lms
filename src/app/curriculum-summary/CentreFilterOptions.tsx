"use client";

import { useEffect, useRef, useState } from "react";

// The Centre filter's checkboxes with a search box that narrows the visible options as you type.
// Hidden options stay in the form, so a ticked Centre is still sent while the search hides it.
// The search box has no `name`, so it is never sent, and it clears with the form's reset (Back /
// Forward, see UrlFilterForm).
export default function CentreFilterOptions({
  options,
  selected,
}: {
  options: { id: number; name: string }[];
  selected: number[];
}) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = searchRef.current?.form;
    const clearSearch = () => setSearch("");
    form?.addEventListener("reset", clearSearch);
    return () => form?.removeEventListener("reset", clearSearch);
  }, []);

  const term = search.trim().toLowerCase();
  return (
    <>
      <input
        ref={searchRef}
        type="search"
        aria-label="Search centres"
        placeholder="Search centres"
        defaultValue=""
        onChange={(event) => setSearch(event.target.value)}
        // Enter narrows the list; it doesn't apply the filters.
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        className="mb-1 rounded-md border border-border bg-bg-card px-2 py-1 text-sm text-text-primary"
      />
      {options.map((option) => (
        <CentreOption
          key={option.id}
          option={option}
          shown={term === "" || option.name.toLowerCase().includes(term)}
          checked={selected.includes(option.id)}
        />
      ))}
    </>
  );
}

function CentreOption({
  option,
  shown,
  checked,
}: {
  option: { id: number; name: string };
  shown: boolean;
  checked: boolean;
}) {
  // Only a shown option gets `flex`: a display utility would override `hidden`.
  return (
    <label hidden={!shown} className={`${shown ? "flex" : ""} items-center gap-2 text-sm text-text-primary`}>
      <input type="checkbox" name="centres" value={option.id} defaultChecked={checked} />
      {option.name}
    </label>
  );
}
