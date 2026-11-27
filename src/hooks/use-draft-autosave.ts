import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// The draft autosave of a notes form, shared by Holistic Post-Session Notes
// and AI Test Insights Session Notes: a change is sent `delayMs` after the
// last one, one save at a time, and while a save is in flight only the newest
// value waits to go next. (`useAutoSave` is the visit actions' autosave,
// which drops a change made while a save is in flight.)

/** The autosave's memory, kept by the form so a reload of the notes can reset it. */
export interface DraftAutosaveRefs<T> {
  /** `JSON.stringify` of the value the server holds. */
  savedRef: RefObject<string>;
  /** The value to send next; a newer one replaces it. */
  queuedRef: RefObject<T | null>;
  /** The run of saves in flight: true when it ended with everything saved. */
  inFlightRef: RefObject<Promise<boolean> | null>;
  timerRef: RefObject<number | null>;
}

/** The autosave's memory for a form whose server copy starts as `initialValue`. */
export function useDraftAutosaveRefs<T>(initialValue: T): DraftAutosaveRefs<T> {
  const savedRef = useRef(JSON.stringify(initialValue));
  const queuedRef = useRef<T | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number | null>(null);
  return { savedRef, queuedRef, inFlightRef, timerRef };
}

interface DraftAutosaveHandlers<T> {
  /** Sends one value; throws when it was not saved. */
  save: (value: T) => Promise<void>;
  /** Checked before each send: true drops what is queued (the form froze or went stale). */
  isStopped?: () => boolean;
  onSaving: () => void;
  onSaved: (value: T) => void;
  /** A save threw; nothing more is sent until the next change or flush. */
  onFailed: (caught: unknown) => void;
  /** Everything queued has been saved. */
  onDrained: () => void;
}

/**
 * Autosaves `value` while `enabled`, `delayMs` after its last change, unless
 * it matches what the server will hold once the saves queued and in flight
 * are done. Returns `flush`: send any change (or, when
 * `failed`, the value again) now, and wait until nothing is queued or in
 * flight; true when everything is saved. `flush` saves nothing unless
 * `canFlush`.
 */
export function useDraftAutosave<T>({
  value,
  refs,
  enabled,
  canFlush,
  failed,
  delayMs,
  ...handlers
}: DraftAutosaveHandlers<T> & {
  value: T;
  refs: DraftAutosaveRefs<T>;
  enabled: boolean;
  canFlush: boolean;
  failed: boolean;
  delayMs: number;
}): () => Promise<boolean> {
  const { savedRef, queuedRef, inFlightRef, timerRef } = refs;
  // `JSON.stringify` of the value being sent now, or null.
  const sendingRef = useRef<string | null>(null);
  // The newest handlers, so a save in flight reports to the current render.
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  const pump = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;
    const work = (async () => {
      while (queuedRef.current) {
        // Stopped while a save was in flight: what was queued behind it is never sent.
        if (handlersRef.current.isStopped?.()) {
          queuedRef.current = null;
          return false;
        }
        const next = queuedRef.current;
        queuedRef.current = null;
        sendingRef.current = JSON.stringify(next);
        handlersRef.current.onSaving();
        try {
          await handlersRef.current.save(next);
          savedRef.current = JSON.stringify(next);
          handlersRef.current.onSaved(next);
        } catch (caught) {
          handlersRef.current.onFailed(caught);
          return false;
        } finally {
          sendingRef.current = null;
        }
      }
      handlersRef.current.onDrained();
      return true;
    })().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = work;
    return work;
  }, [inFlightRef, queuedRef, savedRef]);

  // What the server will hold once nothing is queued or in flight: a value
  // that matches it needs no save, and any other value does, even one that
  // matches what the server holds now (typing undone while a newer save is out).
  const matchesServerSoon = useCallback(
    (candidate: T) => {
      const target = queuedRef.current ? JSON.stringify(queuedRef.current) : (sendingRef.current ?? savedRef.current);
      return JSON.stringify(candidate) === target;
    },
    [queuedRef, savedRef],
  );

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, [timerRef]);

  const flush = useCallback(async () => {
    cancelTimer();
    if (!canFlush) return true;
    if (!matchesServerSoon(value) || failed) queuedRef.current = value;
    while (queuedRef.current || inFlightRef.current) {
      if (!(await pump())) return false;
    }
    return true;
  }, [value, canFlush, failed, cancelTimer, inFlightRef, pump, queuedRef, matchesServerSoon]);

  useEffect(() => {
    if (!enabled || matchesServerSoon(value)) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      queuedRef.current = value;
      void pump();
    }, delayMs);
    return cancelTimer;
  }, [value, enabled, delayMs, timerRef, cancelTimer, pump, queuedRef, matchesServerSoon]);

  return flush;
}
