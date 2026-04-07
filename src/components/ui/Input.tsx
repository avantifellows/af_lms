"use client";

import { InputHTMLAttributes, forwardRef } from "react";
import { baseInputClasses } from "./styles";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full min-h-[44px] ${baseInputClasses} ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
