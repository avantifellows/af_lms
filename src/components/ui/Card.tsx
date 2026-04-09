"use client";

import { HTMLAttributes, forwardRef } from "react";

const elevationClasses = {
  sm: "bg-bg-card rounded-lg border border-border shadow-sm",
  md: "bg-bg-card rounded-lg border border-border shadow hover:shadow-md transition-shadow",
  xl: "bg-bg-card rounded-xl shadow-xl",
} as const;

export type CardElevation = keyof typeof elevationClasses;

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ elevation = "md", className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`${elevationClasses[elevation]} ${className}`}
        {...props}
      />
    );
  }
);

Card.displayName = "Card";
