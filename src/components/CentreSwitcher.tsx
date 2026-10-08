"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { PAGE_TITLE_CLASS } from "@/components/PageHeader";
import { Badge } from "@/components/ui";
import type { CentreSwitcherOption } from "@/lib/centre-switcher";

/**
 * The Centre page title as a switcher. The h1 holds only the trigger, so the
 * heading's accessible name stays exactly the Centre name; the popup is the
 * heading's sibling, never inside it. Option logic (order, labels) lives in
 * `@/lib/centre-switcher`; this component only renders and navigates.
 */
export default function CentreSwitcher({ options }: { options: CentreSwitcherOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const listboxId = useId();
  const current = options.find((option) => option.isCurrent) ?? options[0];

  // The one place a choice becomes navigation.
  function select(option: CentreSwitcherOption) {
    if (option.isCurrent) return;
    setOpen(false);
    router.push(`/centre/${option.id}`);
  }

  return (
    <div className="relative min-w-0">
      <h1 className={PAGE_TITLE_CLASS}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-describedby={descriptionId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex max-w-full items-center gap-1 rounded text-left uppercase hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="min-w-0 break-words">{current.primary}</span>
          <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0" />
        </button>
      </h1>
      <span id={descriptionId} className="sr-only">
        Switch Centre
      </span>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-bg-card shadow-lg">
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Centres"
            className="max-h-80 overflow-y-auto py-1"
          >
            {options.map((option) => (
              <li
                key={option.id}
                role="option"
                aria-selected={option.isCurrent}
                aria-disabled={option.isCurrent || undefined}
                onClick={() => select(option)}
                className={`px-3 py-2 text-sm ${
                  option.isCurrent
                    ? "cursor-default bg-bg-card-alt"
                    : "cursor-pointer hover:bg-bg-card-alt"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary">{option.primary}</span>
                  {option.isCurrent && <Badge variant="accent">Current</Badge>}
                </span>
                <span className="block text-xs text-text-muted">{option.context}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
