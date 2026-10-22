"use client";

import { useId } from "react";

import { FormLabel, Input } from "@/components/ui";
import type { FlagRecipient } from "@/lib/blended-learning-mentee-detail";

import { FLAG_SWITCH } from "../flagRecipients";
import { FieldError, Optional } from "./formParts";
import { FLAG_RECIPIENTS, raisedFlags, type DraftFlags, type FieldErrors } from "./logEntryPayload";

// As in the mockup: below a rule, the switches two to a row (one on mobile),
// then a comment field for each switched-on flag.

const SWITCH_CLASSES =
  "relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-border transition-colors before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-bg-card before:shadow-sm before:transition-transform checked:bg-accent checked:before:translate-x-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function FlagSwitch({ recipient, on, onToggle }: { recipient: FlagRecipient; on: boolean; onToggle: () => void }) {
  const { label, hint } = FLAG_SWITCH[recipient];
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <input type="checkbox" role="switch" checked={on} onChange={onToggle} className={SWITCH_CLASSES} />
      <span className="text-sm font-bold text-text-primary">
        {label}
        {hint && <span className="font-normal text-text-muted">{` ${hint}`}</span>}
      </span>
    </label>
  );
}

function FlagComment({
  recipient,
  value,
  error,
  onChange,
}: {
  recipient: FlagRecipient;
  value: string;
  error?: string;
  onChange: (comment: string) => void;
}) {
  const commentId = `${useId()}-comment`;
  const { commentFor, placeholder, help } = FLAG_SWITCH[recipient];
  return (
    <div>
      <FormLabel htmlFor={commentId}>
        {`Comment for ${commentFor}`} <Optional />
      </FormLabel>
      <Input
        id={commentId}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
      />
      <p className="mt-1 text-sm text-text-secondary">{help}</p>
      <FieldError message={error} />
    </div>
  );
}

export function MentorFlagsEditor({
  flags,
  errors,
  onChange,
}: {
  flags: DraftFlags;
  errors: FieldErrors;
  onChange: (flags: DraftFlags) => void;
}) {
  // Errors are keyed by position among the switched-on flags, as submitted.
  const raised = raisedFlags(flags);
  const listErrors = Object.entries(errors).filter(
    ([field]) => (field === "flags" || field.startsWith("flags.")) && !field.endsWith(".comment")
  );

  function toggle(recipient: FlagRecipient) {
    const next = { ...flags };
    if (next[recipient] !== undefined) delete next[recipient];
    else next[recipient] = "";
    onChange(next);
  }

  return (
    <fieldset className="space-y-4 border-t border-border pt-5">
      <legend className="sr-only">Mentor Flags (optional)</legend>
      <div className="grid gap-x-7 gap-y-1 sm:grid-cols-2">
        {FLAG_RECIPIENTS.map((recipient) => (
          <FlagSwitch
            key={recipient}
            recipient={recipient}
            on={flags[recipient] !== undefined}
            onToggle={() => toggle(recipient)}
          />
        ))}
      </div>
      {raised.map((recipient, index) => (
        <FlagComment
          key={recipient}
          recipient={recipient}
          value={flags[recipient] ?? ""}
          error={errors[`flags.${index}.comment`]}
          onChange={(comment) => onChange({ ...flags, [recipient]: comment })}
        />
      ))}
      {listErrors.map(([field, message]) => (
        <FieldError key={field} message={message} />
      ))}
    </fieldset>
  );
}
