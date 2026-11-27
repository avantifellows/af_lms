"use client";

import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";
import { APPLICATION_PASSWORD_MAX_LENGTH } from "@/lib/competitive-exams";

import { FieldError, LABEL_CLASSES, Optional } from "../students/[id]/log/formParts";

// The JEE form's exam-portal password. It is write-only: page data says only
// whether one is saved, never what it is.
//
// - JeePasswordField: the Filled form's field. Required while none is saved;
//   once one is, it shows "Saved" with Show password and Replace password.
// - JeePasswordReveal: "Show password". Each Show asks the server, which logs
//   the reveal before answering (and refuses one it can't log). Hide forgets
//   it again. A read-only account can't reveal (the server refuses it too):
//   the button stays in place, disabled as View only.

type RevealState = { kind: "hidden" } | { kind: "loading" } | { kind: "shown"; password: string } | { kind: "error"; message: string };

async function fetchPassword(studentId: number): Promise<RevealState> {
  try {
    const response = await fetch(`/api/blended-learning/students/${studentId}/jee-form/password`, {
      method: "POST",
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as { password?: unknown; error?: string };
    if (response.ok && typeof data.password === "string") return { kind: "shown", password: data.password };
    return { kind: "error", message: data.error ?? "Couldn't show the password. Try again." };
  } catch {
    return { kind: "error", message: "Couldn't show the password. Check your connection and try again." };
  }
}

export function JeePasswordReveal({ studentId, canReveal }: { studentId: number; canReveal: boolean }) {
  const [state, setState] = useState<RevealState>({ kind: "hidden" });

  if (!canReveal) {
    return (
      <Button type="button" variant="ghost" size="sm" disabled title="View only">
        <Eye aria-hidden="true" className="h-4 w-4" />
        Show password
      </Button>
    );
  }

  async function show() {
    setState({ kind: "loading" });
    setState(await fetchPassword(studentId));
  }

  if (state.kind === "shown") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="font-mono break-all text-text-primary">{state.password}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setState({ kind: "hidden" })}>
          <EyeOff aria-hidden="true" className="h-4 w-4" />
          Hide password
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={state.kind === "loading"} onClick={() => void show()}>
        <Eye aria-hidden="true" className="h-4 w-4" />
        {state.kind === "loading" ? "Showing…" : "Show password"}
      </Button>
      {state.kind === "error" && (
        <span role="alert" className="text-sm text-danger">
          {state.message}
        </span>
      )}
    </span>
  );
}

type FieldProps = {
  studentId: number;
  passwordSaved: boolean;
  value: string;
  replacing: boolean;
  error?: string;
  onChange: (value: string) => void;
  onReplace: (replacing: boolean) => void;
};

function SavedPassword({ studentId, onReplace }: Pick<FieldProps, "studentId" | "onReplace">) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-success">
        <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
        Password saved
      </span>
      {/* Only a recorder (a Mentor, not read-only) edits, and may reveal. */}
      <JeePasswordReveal studentId={studentId} canReveal />
      <Button type="button" variant="ghost" size="sm" onClick={() => onReplace(true)}>
        Replace password
      </Button>
    </div>
  );
}

// The password input with its own Show/Hide, and "Keep saved password" while
// a saved one is being replaced (blank keeps it).
function TypedPassword({
  inputId,
  passwordSaved,
  value,
  error,
  onChange,
  onReplace,
}: Omit<FieldProps, "studentId" | "replacing"> & { inputId: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={APPLICATION_PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          required={!passwordSaved}
          aria-invalid={Boolean(error)}
          placeholder={passwordSaved ? "New password" : undefined}
          className={`block w-full max-w-sm bg-bg-input font-mono ${baseInputClasses}`}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setVisible(!visible)}>
          {visible ? "Hide typed password" : "Show typed password"}
        </Button>
        {passwordSaved && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onReplace(false)}>
            Keep saved password
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-text-muted">Saved encrypted. Showing it later is logged.</p>
    </>
  );
}

export function JeePasswordField(props: FieldProps) {
  const inputId = useId();
  const { studentId, passwordSaved, replacing, error, onReplace } = props;
  const typing = !passwordSaved || replacing;
  return (
    <div>
      <label htmlFor={typing ? inputId : undefined} className={LABEL_CLASSES}>
        Exam portal password {passwordSaved && replacing && <Optional />}
      </label>
      {typing ? <TypedPassword {...props} inputId={inputId} /> : <SavedPassword studentId={studentId} onReplace={onReplace} />}
      <FieldError message={error} />
    </div>
  );
}
