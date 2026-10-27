"use client";

import { Info, X } from "lucide-react";
import { useState } from "react";

// What the log form shows for Action Items carried over from the Profile
// Doc's latest conversation: a notice above the list, dismissible, and a
// marker on each carried row whose explanation opens on tap, click or hover,
// so it still reads right after scrolling and works on a phone.

const CARRIED_EXPLANATION = "Auto-filled from the last conversation in the Profile Doc";

export function CarriedItemsNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div role="note" className="flex items-start gap-2 rounded-lg border border-border bg-info-bg py-1 pl-3 text-sm text-text-primary">
      <Info aria-hidden="true" className="mt-2.5 h-4 w-4 shrink-0 text-text-secondary" />
      <p className="min-w-0 grow py-2">
        These action items were auto-filled from the last conversation in the Profile Doc. Remove any that are done before
        saving.
      </p>
      <button
        type="button"
        aria-label="Dismiss this notice"
        onClick={() => setDismissed(true)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-hover-bg hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

// "From Profile Doc" under a carried row. The explanation is the row's
// description too (`tipId`), so a screen reader hears it on the text field.
// It shows at once, fully opaque (no fade), above the rows after it: no
// ancestor below the Action items list sets a z-index, so z-20 wins over the
// next row's select. The marker itself gets no z-index, so it scrolls under
// the sticky save bar.
export function CarriedMarker({ tipId }: { tipId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={tipId}
        onClick={() => setOpen((current) => !current)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded text-xs font-bold text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:min-h-8"
      >
        <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        From Profile Doc
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={`absolute left-0 top-full z-20 w-60 max-w-[calc(100vw-3rem)] rounded-md bg-text-primary px-2.5 py-1.5 text-xs font-normal text-bg-card shadow-md group-hover:block ${open ? "block" : "hidden"}`}
      >
        {CARRIED_EXPLANATION}
      </span>
    </span>
  );
}
