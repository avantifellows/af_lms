"use client";

import { HTMLAttributes, forwardRef } from "react";

const variantClasses = {
  default: "bg-gray-100 text-gray-700",
  accent: "bg-success-bg text-accent-hover",
  info: "bg-info-bg text-info",
  success: "bg-green-100 text-green-800",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-danger-bg text-danger",
} as const;

export type BadgeVariant = keyof typeof variantClasses;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${variantClasses[variant]} ${className}`}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";
