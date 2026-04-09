"use client";

import { HTMLAttributes, forwardRef } from "react";

interface FormSectionProps extends HTMLAttributes<HTMLDivElement> {
  /** Override the default space-y-4 spacing */
  spacing?: string;
}

export const FormSection = forwardRef<HTMLDivElement, FormSectionProps>(
  ({ spacing = "space-y-4", className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`rounded-lg border border-border p-4 shadow-sm ${spacing} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

FormSection.displayName = "FormSection";
