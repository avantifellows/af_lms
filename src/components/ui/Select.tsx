"use client";

import { SelectHTMLAttributes, forwardRef } from "react";
import { baseInputClasses } from "./styles";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`w-full min-h-[44px] ${baseInputClasses} ${className}`}
        {...props}
      />
    );
  }
);

Select.displayName = "Select";
