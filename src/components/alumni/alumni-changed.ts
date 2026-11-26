import { useEffect, useRef } from "react";

// A change made to many alumni at once (undoing a change from History) is
// announced on the page, so the lists and the table already showing those
// alumni load again instead of keeping old values.

const ALUMNI_CHANGED = "alumni:changed";

export function announceAlumniChanged() {
  window.dispatchEvent(new Event(ALUMNI_CHANGED));
}

/** Calls `onChanged` whenever alumni change on this page. */
export function useOnAlumniChanged(onChanged: () => void) {
  const latest = useRef(onChanged);
  useEffect(() => {
    latest.current = onChanged;
  });
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(ALUMNI_CHANGED, listener);
    return () => window.removeEventListener(ALUMNI_CHANGED, listener);
  }, []);
}
