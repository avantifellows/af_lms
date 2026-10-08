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
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // router.push returns nothing to await, so a ref (set before push, in the
  // same turn) stops a second choice racing the first; isPending mirrors it
  // for the indicator and releases it once the navigation settles.
  const navigatingRef = useRef(false);
  const [isPending, startTransition] = useTransition();
  const descriptionId = useId();
  const listboxId = useId();
  const current = options.find((option) => option.isCurrent) ?? options[0];
  const visible = options.filter((option) => matchesCentreSearch(option, query));
  // Only non-current options can be active; one filtered away is simply gone.
  const selectable = visible.filter((option) => !option.isCurrent);
  const activeIndex = selectable.findIndex((option) => option.id === activeId);
  const active = activeIndex >= 0 ? selectable[activeIndex] : null;
  const optionDomId = (option: CentreSwitcherOption) => `${listboxId}-option-${option.id}`;

  // However it opened, the popup hands focus to its search input.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!isPending) navigatingRef.current = false;
  }, [isPending]);

  function openPopup() {
    setQuery("");
    setActiveId(null);
    setOpen(true);
  }

  // Escape and the trigger hand focus back to the trigger; Tab or a click on
  // another control leaves focus wherever the user put it.
  function closePopup(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  // Focus leaving the popup closes it. With nowhere to go (a click on
  // non-focusable content), focus returns to the trigger.
  function handleInputBlur(event: React.FocusEvent<HTMLInputElement>) {
    const next = event.relatedTarget;
    if (next && popupRef.current?.contains(next)) return;
    closePopup(next === null);
  }

  function moveActive(index: number) {
    const option = selectable[Math.max(0, Math.min(index, selectable.length - 1))];
    if (option) setActiveId(option.id);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const moves: Record<string, number> = {
      ArrowDown: activeIndex + 1,
      ArrowUp: activeIndex - 1,
      Home: 0,
      End: selectable.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      moveActive(moves[event.key]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active) select(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePopup(true);
    }
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
          className="inline-flex max-w-full items-center gap-1 rounded text-left uppercase hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="min-w-0 break-words">{current.primary}</span>
          <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0" />
        </button>
      </h1>
      <span id={descriptionId} className="sr-only">
        Switch Centre
      </span>
      {/* Outside the h1 so the heading's name stays the Centre name. */}
      <span role="status" className="flex items-center gap-1 text-sm text-text-muted">
        {isPending && (
          <>
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            Switching Centre…
          </>
        )}
      </span>
      {open && (
        <div
          ref={popupRef}
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
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionDomId(active) : undefined}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              placeholder="Search Centre, Program, School or code"
              className="min-h-[44px] w-full rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Centres"
            className="max-h-[60vh] overflow-y-auto py-1 sm:max-h-80"
          >
            {visible.map((option) => (
              <li
                key={option.id}
                id={optionDomId(option)}
                role="option"
                aria-selected={option.isCurrent}
                aria-disabled={option.isCurrent || undefined}
                onClick={() => select(option)}
                className={`min-h-[44px] px-3 py-2 text-sm ${
                  option.isCurrent
                    ? "cursor-default bg-bg-card-alt"
                    : option.id === active?.id
                      ? "cursor-pointer bg-bg-card-alt"
                      : "cursor-pointer hover:bg-bg-card-alt"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary">{option.primary}</span>
                  {option.isCurrent && <Badge variant="accent">Current</Badge>}
                </span>
                <span className="block text-xs text-text-muted">{option.context}</span>
                {option.disambiguator && (
                  <span className="block text-xs text-text-muted">{option.disambiguator}</span>
                )}
              </li>
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
      )}
    </div>
  );
}
