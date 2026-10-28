"use client";

import { ClipboardList } from "lucide-react";
import { useId } from "react";

import { SCREENER_END_LABEL, SCREENER_QUESTIONS, SCREENER_SCALE } from "../screenerQuestions";
import { FieldError } from "./formParts";
import { screenerQuestionsShown, type EntryFormValues, type FieldErrors } from "./logEntryPayload";
import type { ChangeValues } from "./SessionDetailsCard";

// The end of a Conversation's form, below a rule, when the Student has a
// Screener link: "Was the screener form used?", unticked. Ticked while the
// Student has no Screener Feedback yet, it asks two required 1-5 questions,
// once per Student; after that a tick only records that the form was used.

const OPTION_CLASSES =
  "relative flex min-h-11 cursor-pointer items-center justify-center font-mono text-sm font-bold text-text-secondary transition-colors hover:bg-hover-bg has-[:checked]:bg-accent has-[:checked]:text-text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-text-primary";

// Five joined native radios, so arrow keys and screen readers treat it as
// one radio group; 1 and 5 carry their labels in their names.
function RatingScale({
  question,
  value,
  error,
  onChange,
}: {
  question: string;
  value: number | null;
  error?: string;
  onChange: (rating: number) => void;
}) {
  const name = `${useId()}-rating`;
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-bold text-text-primary">{question}</legend>
      <div className="max-w-xs">
        <div className="grid grid-cols-5 divide-x-2 divide-border overflow-hidden rounded-lg border-2 border-border bg-bg-card">
          {SCREENER_SCALE.map((rating) => (
            <label key={rating} className={OPTION_CLASSES}>
              <input
                type="radio"
                name={name}
                value={rating}
                required
                checked={value === rating}
                onChange={() => onChange(rating)}
                aria-label={SCREENER_END_LABEL[rating] ? `${rating}, ${SCREENER_END_LABEL[rating]}` : String(rating)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              {rating}
            </label>
          ))}
        </div>
        <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-text-muted">
          <span>{SCREENER_END_LABEL[1]}</span>
          <span>{SCREENER_END_LABEL[5]}</span>
        </div>
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}

export function ScreenerQuestion({
  values,
  change,
  fieldErrors,
  clearErrors,
}: {
  values: EntryFormValues;
  change: ChangeValues;
  fieldErrors: FieldErrors;
  clearErrors: (prefix: string) => void;
}) {
  if (values.screenerUsed === null) return null;
  return (
    <div className="space-y-4 border-t border-border pt-5">
      <div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={values.screenerUsed}
            onChange={(event) => {
              const screenerUsed = event.target.checked;
              change(() => ({ screenerUsed }));
              clearErrors("screener");
            }}
            className="h-5 w-5 shrink-0 accent-accent"
          />
          <ClipboardList aria-hidden="true" className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="text-sm font-bold text-text-primary">Was the screener form used?</span>
        </label>
        <FieldError message={fieldErrors.screenerUsed ?? fieldErrors.screenerFeedback} />
      </div>
      {screenerQuestionsShown(values) && (
        <section aria-label="Screener feedback" className="space-y-5 rounded-lg bg-bg-card-alt p-4">
          <p className="text-sm text-text-secondary">Asked once for each student. Both are required.</p>
          {SCREENER_QUESTIONS.map(({ key, question }) => (
            <RatingScale
              key={key}
              question={question}
              value={values.screenerRatings[key]}
              error={fieldErrors[`screenerFeedback.${key}`]}
              onChange={(rating) => {
                change(({ screenerRatings }) => ({ screenerRatings: { ...screenerRatings, [key]: rating } }));
                clearErrors(`screenerFeedback.${key}`);
              }}
            />
          ))}
        </section>
      )}
    </div>
  );
}
