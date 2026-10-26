"use client";

import { useEffect, useId, useRef, useState } from "react";

// The ⓘ beside a page title: a button that opens a short "how to read this page" guide in a
// non-modal popover. Focus moves into the guide when it opens; Esc or the button closes it and
// returns focus to the button, and a click outside closes it. Each item is one bullet; text
// between ** pairs is bold.
export default function PageGuide({ items }: { items: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="How to read this page"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm font-bold text-text-muted hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="How to read this page"
          tabIndex={-1}
          className="fixed inset-x-4 top-16 z-30 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-bg-card p-4 text-left text-sm font-normal normal-case tracking-normal text-text-secondary shadow-lg focus:outline-none sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[28rem]"
        >
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">How to read this page</p>
          <ul className="list-disc space-y-2 pl-5">
            {items.map((item) => (
              <li key={item}>
                <GuideText text={item} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}

// "a **term** b" → a <strong>term</strong> b: odd-numbered pieces between ** are bold.
function GuideText({ text }: { text: string }) {
  return text.split("**").map((piece, index) => (index % 2 === 1 ? <strong key={index}>{piece}</strong> : piece));
}
