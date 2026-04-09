"use client";

import { HTMLAttributes, forwardRef } from "react";

interface StickyProgressBarProps extends HTMLAttributes<HTMLDivElement> {}

export const StickyProgressBar = forwardRef<HTMLDivElement, StickyProgressBarProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`sticky top-12 z-10 rounded-lg border-2 border-border-accent bg-bg-card-alt px-3 py-2.5 shadow-sm ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

StickyProgressBar.displayName = "StickyProgressBar";
