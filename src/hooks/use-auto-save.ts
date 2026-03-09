import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

interface PersistSuccess {
  ok: true;
  action: { data: Record<string, unknown> };
}

interface PersistFailure {
  ok: false;
  status: number;
  error: { message: string; details: string[] };
}

interface AutoSaveOptions {
  formData: Record<string, unknown>;
  actionType: string;
  canSave: boolean;
  isBusy: boolean;
  persistFn: (data: Record<string, unknown>) => Promise<PersistSuccess | PersistFailure>;
  sanitizeFn: (actionType: string, data: Record<string, unknown>) => Record<string, unknown>;
  onSuccess: (action: { data: Record<string, unknown> }) => void;
  debounceMs?: number;
}

interface AutoSaveReturn {
  saveStatus: AutoSaveStatus;
  hasPendingChanges: boolean;
  flushAndCancel: () => Promise<void>;
  cancelAutoSave: () => void;
  markSynced: (data: Record<string, unknown>) => void;
}

export function useAutoSave({
  formData,
  actionType,
  canSave,
  isBusy,
  persistFn,
  sanitizeFn,
  onSuccess,
  debounceMs = 2000,
}: AutoSaveOptions): AutoSaveReturn {
  const [saveStatus, setSaveStatus] = useState<AutoSaveStatus>("idle");

  const lastSavedDataRef = useRef<string>(JSON.stringify(sanitizeFn(actionType, formData)));

  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  const actionTypeRef = useRef(actionType);
  actionTypeRef.current = actionType;

  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;

  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  const persistFnRef = useRef(persistFn);
  persistFnRef.current = persistFn;

  const sanitizeFnRef = useRef(sanitizeFn);
  sanitizeFnRef.current = sanitizeFn;

  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef(false);
  const inFlightResolveRef = useRef<(() => void) | null>(null);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const doSave = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!canSaveRef.current || isBusyRef.current) return;

    const currentData = formDataRef.current;
    const sanitized = sanitizeFnRef.current(actionTypeRef.current, currentData);
    const serialized = JSON.stringify(sanitized);

    if (serialized === lastSavedDataRef.current) {
      setSaveStatus("idle");
      return;
    }

    inFlightRef.current = true;
    abortRef.current = false;
    setSaveStatus("saving");

    try {
      const result = await persistFnRef.current(sanitized);

      if (abortRef.current) {
        return;
      }

      if (result.ok) {
        lastSavedDataRef.current = serialized;
        onSuccessRef.current(result.action);
        setSaveStatus("saved");
        clearDismissTimer();
        dismissTimerRef.current = setTimeout(() => {
          setSaveStatus((current) => (current === "saved" ? "idle" : current));
          dismissTimerRef.current = null;
        }, 3000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      if (!abortRef.current) {
        setSaveStatus("error");
      }
    } finally {
      inFlightRef.current = false;
      if (inFlightResolveRef.current) {
        inFlightResolveRef.current();
        inFlightResolveRef.current = null;
      }
    }
  }, [clearDismissTimer]);

  // Watch formData for changes and schedule auto-save
  useEffect(() => {
    if (!canSave || isBusy) {
      clearDebounceTimer();
      return;
    }

    const sanitized = sanitizeFn(actionType, formData);
    const serialized = JSON.stringify(sanitized);

    if (serialized === lastSavedDataRef.current) {
      // Data matches baseline — no save needed
      if (!inFlightRef.current) {
        setSaveStatus((current) => {
          if (current === "unsaved") return "idle";
          return current;
        });
      }
      clearDebounceTimer();
      return;
    }

    // Data differs from baseline
    setSaveStatus((current) => {
      if (current === "saving" || current === "saved") return current;
      return "unsaved";
    });

    clearDebounceTimer();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void doSave();
    }, debounceMs);
  }, [formData, actionType, canSave, isBusy, sanitizeFn, debounceMs, clearDebounceTimer, doSave]);

  // beforeunload guard
  const hasPendingChanges = saveStatus === "unsaved" || saveStatus === "saving";

  useEffect(() => {
    if (!hasPendingChanges) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingChanges]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearDebounceTimer();
      clearDismissTimer();
    };
  }, [clearDebounceTimer, clearDismissTimer]);

  const cancelAutoSave = useCallback(() => {
    clearDebounceTimer();
  }, [clearDebounceTimer]);

  const flushAndCancel = useCallback(async () => {
    clearDebounceTimer();
    if (inFlightRef.current) {
      abortRef.current = true;
      await new Promise<void>((resolve) => {
        inFlightResolveRef.current = resolve;
      });
    }
  }, [clearDebounceTimer]);

  const markSynced = useCallback(
    (data: Record<string, unknown>) => {
      lastSavedDataRef.current = JSON.stringify(sanitizeFnRef.current(actionTypeRef.current, data));
      clearDismissTimer();
      setSaveStatus("idle");
    },
    [clearDismissTimer]
  );

  return {
    saveStatus,
    hasPendingChanges,
    flushAndCancel,
    cancelAutoSave,
    markSynced,
  };
}
