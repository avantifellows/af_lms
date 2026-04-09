"use client";

import { LabelHTMLAttributes, forwardRef } from "react";

interface FormLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {}

export const FormLabel = forwardRef<HTMLLabelElement, FormLabelProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={`mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted ${className}`}
        {...props}
      />
    );
  }
);

FormLabel.displayName = "FormLabel";
