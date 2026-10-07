"use client";

import { HTMLAttributes, forwardRef, useCallback, useEffect, useRef } from "react";

interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose?: () => void;
  /** z-index class — default z-50 for primary modals, use z-40 for secondary */
  zIndex?: "z-40" | "z-50";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !element.closest("[hidden], [inert]")
  );
}

// Open modals in opening order; only the topmost one traps Tab.
const openModalStack: object[] = [];

export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ open, onClose, zIndex = "z-50", className = "", children, ...props }, ref) => {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const setDialogRef = useCallback(
      (node: HTMLDivElement | null) => {
        dialogRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    useEffect(() => {
      if (!open) return;
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose?.();
      };
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }, [open, onClose]);

    // Move focus into the dialog on open, keep Tab/Shift+Tab inside it, and
    // hand focus back to whatever opened it once it closes.
    useEffect(() => {
      const dialog = dialogRef.current;
      if (!open || !dialog) return;
      const token = {};
      openModalStack.push(token);
      const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (!dialog.contains(document.activeElement)) {
        (focusableElements(dialog)[0] ?? dialog).focus();
      }

      const trapTab = (e: KeyboardEvent) => {
        if (e.key !== "Tab" || openModalStack[openModalStack.length - 1] !== token) return;
        const focusable = focusableElements(dialog);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!first || !last) {
          e.preventDefault();
          dialog.focus();
        } else if (!dialog.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (active === first || active === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", trapTab);

      return () => {
        document.removeEventListener("keydown", trapTab);
        openModalStack.splice(openModalStack.indexOf(token), 1);
        // Don't steal focus if the caller already moved it somewhere else.
        const active = document.activeElement;
        const focusLeftWithDialog = !active || active === document.body || dialog.contains(active);
        if (focusLeftWithDialog && previouslyFocused?.isConnected) previouslyFocused.focus();
      };
    }, [open]);

    if (!open) return null;

    // Only apply the default max-width when the caller hasn't supplied its own
    // `max-w-*` utility. Two competing `max-w-*` classes both compile and the
    // winner is decided by CSS source order, not class-attribute order, so a
    // hardcoded default can't be reliably overridden by appending.
    const hasMaxWidth = /(^|\s)(sm:|md:|lg:|xl:|2xl:)?max-w-/.test(className);
    const maxWidthClass = hasMaxWidth ? "" : "max-w-lg";

    return (
      <div
        ref={setDialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`fixed inset-0 ${zIndex} overflow-y-auto outline-none`}
        {...props}
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/30"
          onClick={onClose}
          aria-hidden="true"
        />
        {/* Content */}
        <div className="flex min-h-full items-center justify-center p-4">
          <div className={`relative w-full ${maxWidthClass} rounded-lg bg-bg-card shadow-xl ${className}`}>
            {children}
          </div>
        </div>
      </div>
    );
  }
);

Modal.displayName = "Modal";
