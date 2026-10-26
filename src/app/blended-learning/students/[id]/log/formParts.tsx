"use client";

import { useId, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";

import { Card } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";

// Small pieces the log form's cards share: titled cards, field labels and
// errors, a segmented choice, status pills and a textarea that grows.

// As FormLabel looks, for labels that aren't a <label>.
export const LABEL_CLASSES = "mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted";
export const TEXTAREA_CLASSES = `w-full ${baseInputClasses}`;

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-danger">{message}</p>;
}

// "(optional)" after an uppercase label, in normal case.
export function Optional() {
  return <span className="font-normal normal-case tracking-normal">(optional)</span>;
}

// One of the form's cards, titled as in the mockup.
export function FormCard({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <Card elevation="sm" className="space-y-5 p-4 sm:p-6">
        <h2 id={titleId} className="text-lg font-bold text-text-primary">
          {title}
        </h2>
        {children}
      </Card>
    </section>
  );
}

// A field's label row: the label, and while reviewing a draft a marker that
// the field came from the recording.
export function LabelRow({ label, marker }: { label: ReactNode; marker: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      {label}
      {marker && <span className="mb-1 text-xs font-bold text-accent">{marker}</span>}
    </div>
  );
}

// Joined options, one chosen: native radios over each option, so arrow keys,
// screen readers and tests treat it as a radio group. Each option is 44 px.
export function SegmentedChoice<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={LABEL_CLASSES}>{legend}</legend>
      <div className="inline-flex max-w-full divide-x-2 divide-border overflow-hidden rounded-lg border-2 border-border bg-bg-card">
        {options.map((option) => (
          <label
            key={option.value}
            className="relative flex min-h-11 cursor-pointer items-center px-3 text-sm font-bold text-text-secondary transition-colors hover:bg-hover-bg has-[:checked]:bg-accent has-[:checked]:text-text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-text-primary"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            {option.label}
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}

// A small rounded status: busy with a spinner, or done.
export function StatusPill({ tone, children }: { tone: "busy" | "done"; children: ReactNode }) {
  const colours = tone === "done" ? "bg-success-bg text-success" : "bg-hover-bg text-text-primary";
  return (
    <span role="status" className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${colours}`}>
      {tone === "busy" && (
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
        />
      )}
      {children}
    </span>
  );
}

// A one-row textarea that grows with its text, so nothing is clipped.
export function GrowingTextarea({ value, className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      element.style.height = "auto";
      // The 2 px borders on each side are outside scrollHeight.
      if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight + 4}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={`block min-h-11 resize-none overflow-hidden ${TEXTAREA_CLASSES} ${className}`}
      {...props}
    />
  );
}
