"use client";

import { HTMLAttributes, forwardRef, useEffect } from "react";

interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose?: () => void;
  /** z-index class — default z-50 for primary modals, use z-40 for secondary */
  zIndex?: "z-40" | "z-50";
}

export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ open, onClose, zIndex = "z-50", className = "", children, ...props }, ref) => {
    useEffect(() => {
      if (!open) return;
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose?.();
      };
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }, [open, onClose]);

    if (!open) return null;

    return (
      <div
        ref={ref}
        className={`fixed inset-0 ${zIndex} overflow-y-auto`}
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
          <div className={`relative w-full max-w-lg rounded-lg bg-bg-card shadow-xl ${className}`}>
            {children}
          </div>
        </div>
      </div>
    );
  }
);

Modal.displayName = "Modal";
