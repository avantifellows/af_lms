import { useCallback, useEffect, useState } from "react";

/** The state of a read: loading, failed, or whatever `read` made of the answer. */
export type FetchWithRetryState<S> = { status: "loading" } | { status: "failed" } | S;

/**
 * Reads `url` once, and again on each `retry` (which shows `loading` first).
 * `read` turns the response into the state; a fetch that throws reads
 * `failed`. An unmount or a newer read drops an older answer and aborts its
 * fetch. `url` null reads nothing and the state stays `loading`, so a caller
 * with nothing to ask for shows its own state instead.
 *
 * `read` and `init` are effect dependencies: pass module-level values, or the
 * read repeats on every render.
 */
export function useFetchWithRetry<S>(
  url: string | null,
  read: (response: Response) => Promise<S>,
  init?: RequestInit,
): { state: FetchWithRetryState<S>; retry: () => void } {
  const [state, setState] = useState<FetchWithRetryState<S>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let current = true;
    fetch(url, { ...init, signal: controller.signal })
      .then(read)
      .catch((): FetchWithRetryState<S> => ({ status: "failed" }))
      .then((next) => {
        if (current) setState(next);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [url, attempt, read, init]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
