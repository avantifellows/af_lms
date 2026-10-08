"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { PAGE_TITLE_CLASS } from "@/components/PageHeader";
import { Badge } from "@/components/ui";
import {
  centreSwitchHref,
  matchesCentreSearch,
  type CentreSwitcherOption,
} from "@/lib/centre-switcher";
import { resolveVisibleTab } from "@/lib/roster-tabs";

function optionClassName(
  option: CentreSwitcherOption,
  activeId: string | null,
): string {
  if (option.isCurrent) return "cursor-default bg-bg-card-alt";
  if (option.id === activeId) return "cursor-pointer bg-bg-card-alt";
  return "cursor-pointer hover:bg-bg-card-alt";
}

function CentreOption({
  option,
  activeId,
  domId,
  onSelect,
}: {
  option: CentreSwitcherOption;
  activeId: string | null;
  domId: string;
  onSelect: (option: CentreSwitcherOption) => void;
}) {
  return (
    <li
      id={domId}
      role="option"
      aria-selected={option.isCurrent}
      aria-disabled={option.isCurrent || undefined}
      onClick={() => onSelect(option)}
      className={`min-h-[44px] px-3 py-2 text-sm ${optionClassName(option, activeId)}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 break-words font-semibold text-text-primary">
          {option.primary}
        </span>
        {option.isCurrent && <Badge variant="accent">Current</Badge>}
      </span>
      <span className="block text-xs text-text-muted">{option.context}</span>
      {option.disambiguator && (
        <span className="block text-xs text-text-muted">
          {option.disambiguator}
        </span>
      )}
    </li>
  );
}

type KeyboardAction =
  { kind: "move"; index: number } | { kind: "select" } | null;

function keyboardAction(
  key: string,
  activeIndex: number,
  optionCount: number,
): KeyboardAction {
  const moves: Record<string, number> = {
    ArrowDown: activeIndex + 1,
    ArrowUp: activeIndex - 1,
    Home: 0,
    End: optionCount - 1,
  };
  if (key in moves) return { kind: "move", index: moves[key] };
  if (key === "Enter") return { kind: "select" };
  return null;
}

function CentreSwitcherPopup({
  options,
  listboxId,
  onClose,
  onSelect,
}: {
  options: CentreSwitcherOption[];
  listboxId: string;
  onClose: (restoreFocus: boolean) => void;
  onSelect: (option: CentreSwitcherOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = options.filter((option) =>
    matchesCentreSearch(option, query),
  );
  const selectable = visible.filter((option) => !option.isCurrent);
  const activeIndex = selectable.findIndex((option) => option.id === activeId);
  const active = activeIndex >= 0 ? selectable[activeIndex] : null;
  const optionDomId = (option: CentreSwitcherOption) =>
    `${listboxId}-option-${option.id}`;

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (!activeId) return;
    document
      .getElementById(`${listboxId}-option-${activeId}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, listboxId]);

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next && event.currentTarget.contains(next)) return;
    onClose(next === null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose(true);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const action = keyboardAction(event.key, activeIndex, selectable.length);
    if (!action) return;
    event.preventDefault();
    if (action.kind === "select") {
      if (active) onSelect(active);
      return;
    }
    const index = Math.max(0, Math.min(action.index, selectable.length - 1));
    const option = selectable[index];
    if (option) setActiveId(option.id);
  }

  return (
    <div
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      // Clicks inside the popup (options, padding) keep focus in the input.
      onMouseDown={(event) => {
        if (event.target !== inputRef.current) event.preventDefault();
      }}
      className="absolute inset-x-2 top-full z-30 mt-1 rounded-lg border border-border bg-bg-card shadow-lg sm:inset-x-auto sm:left-0 sm:mt-2 sm:w-[min(28rem,calc(100vw-2rem))]"
    >
      <div className="border-b border-border p-2">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search Centres"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionDomId(active) : undefined}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search Centre, Program, School or code"
          className="min-h-[44px] w-full rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Centres"
        tabIndex={-1}
        className="max-h-[60vh] overflow-y-auto py-1 sm:max-h-80"
      >
        {visible.map((option) => (
          <CentreOption
            key={option.id}
            option={option}
            activeId={active?.id ?? null}
            domId={optionDomId(option)}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {visible.length === 0 && (
        <div className="px-3 py-3 text-sm text-text-muted">
          <p>No accessible Centres match your search</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="mt-2 min-h-[44px] font-semibold text-accent hover:underline"
          >
            Clear search
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Centre page title as a switcher. The h1 holds only the trigger, so the
 * heading's accessible name stays exactly the Centre name; the popup is the
 * heading's sibling, never inside it. Option logic (order, labels) lives in
 * `@/lib/centre-switcher`; this component only renders and navigates.
 *
 * `tabIds`/`defaultTab` are the source page's visible outer tabs, so a switch
 * carries the tab the user actually sees, never a hidden raw `?tab=`.
 */
export default function CentreSwitcher({
  options,
  tabIds,
  defaultTab,
}: {
  options: CentreSwitcherOption[];
  tabIds: readonly string[];
  defaultTab?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // router.push returns nothing to await, so a ref (set before push, in the
  // same turn) stops a second choice racing the first; isPending mirrors it
  // for the indicator and releases it once the navigation settles.
  const navigatingRef = useRef(false);
  const [isPending, startTransition] = useTransition();
  const descriptionId = useId();
  const listboxId = useId();
  const current = options.find((option) => option.isCurrent) ?? options[0];

  useEffect(() => {
    if (!isPending) navigatingRef.current = false;
  }, [isPending]);

  function openPopup() {
    setOpen(true);
  }

  // Escape and the trigger hand focus back to the trigger; Tab or a click on
  // another control leaves focus wherever the user put it.
  function closePopup(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  // The one place a choice becomes navigation.
  function select(option: CentreSwitcherOption) {
    if (option.isCurrent || navigatingRef.current) return;
    navigatingRef.current = true;
    setOpen(false);
    // Outer-tab clicks rewrite ?tab= with history.replaceState, which Next
    // surfaces through useSearchParams, so read it now rather than from props.
    const tab = resolveVisibleTab(searchParams.get("tab"), tabIds, defaultTab);
    startTransition(() => router.push(centreSwitchHref(option.id, tab)));
  }

  return (
    // Below `sm` the popup anchors to the (positioned) page header and spans
    // its width; from `sm` up it anchors below the title.
    <div className="min-w-0 sm:relative">
      <h1 className={PAGE_TITLE_CLASS}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-describedby={descriptionId}
          // Keep focus in the search input until the click decides open/close.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (open ? closePopup(true) : openPopup())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              openPopup();
            }
          }}
          className="inline-flex min-h-[44px] max-w-full items-center gap-1 rounded text-left uppercase hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="min-w-0 break-words">{current.primary}</span>
          <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0" />
        </button>
      </h1>
      <span id={descriptionId} className="sr-only">
        Switch Centre
      </span>
      {/* Outside the h1 so the heading's name stays the Centre name. */}
      <span
        role="status"
        className="flex items-center gap-1 text-sm text-text-muted"
      >
        {isPending && (
          <>
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            Switching Centre…
          </>
        )}
      </span>
      {open && (
        <CentreSwitcherPopup
          options={options}
          listboxId={listboxId}
          onClose={closePopup}
          onSelect={select}
        />
      )}
    </div>
  );
}
