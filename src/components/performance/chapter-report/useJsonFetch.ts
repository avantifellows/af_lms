"use client";

import { useEffect, useRef, useState } from "react";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * GETs JSON from `url`, refetching when it changes. A newer request (or unmount)
 * aborts the older one, and nothing it returns afterwards is published. A non-2xx
 * response is an error carrying the body's `error`, else `failure`.
 */
export function useJsonFetch<T>(url: string, failure: string, onData?: (data: T) => void): FetchState<T> {
  // Tagged with its URL: a result for an earlier URL reads as loading.
  const [state, setState] = useState<{ url: string; value: FetchState<T> } | null>(null);
  // The latest callback, so a new function each render does not refetch.
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  });

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    // The same fetch as TestDeepDive and CumulativeALTable, which could move onto this hook.
    // fallow-ignore-next-line code-duplication
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || failure);
        }
        return res.json() as Promise<T>;
      })
      .then((data) => {
        if (!current) return;
        setState({ url, value: { status: "ready", data } });
        onDataRef.current?.(data);
      })
      .catch((err) => {
        if (current && err.name !== "AbortError") setState({ url, value: { status: "error", message: err.message } });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [url, failure]);

  return state?.url === url ? state.value : { status: "loading" };
}
