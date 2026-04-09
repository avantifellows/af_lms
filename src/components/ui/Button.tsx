"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

const base =
  "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

const variantClasses = {
  primary:
    `${base} rounded-lg bg-accent px-4 text-sm font-bold text-text-on-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90`,
  secondary:
    `${base} rounded-lg border border-border bg-bg-card px-4 text-sm text-text-primary shadow-sm hover:bg-hover-bg active:bg-bg-card-alt`,
  ghost:
    `${base} rounded-lg px-4 text-sm text-accent hover:bg-hover-bg active:bg-hover-bg/80`,
  danger:
    `${base} rounded-lg bg-danger px-4 text-sm text-white shadow-sm hover:bg-red-700 active:bg-red-800`,
  "danger-ghost":
    `${base} rounded-lg px-4 text-sm text-danger hover:bg-danger-bg active:bg-danger-bg/80`,
  icon:
    `${base} rounded-md p-2 text-text-muted hover:text-text-primary hover:bg-hover-bg active:bg-bg-card-alt`,
} as const;

const sizeClasses = {
  sm: "min-h-[36px] py-1.5 text-xs gap-1.5",
  md: "min-h-[44px] py-2.5 text-sm gap-2",
  lg: "min-h-[48px] py-3 text-base gap-2.5",
} as const;

export type ButtonVariant = keyof typeof variantClasses;
export type ButtonSize = keyof typeof sizeClasses;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
