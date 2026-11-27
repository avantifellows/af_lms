import { useEffect, useRef } from "react";
import type { useRouter } from "next/navigation";

// The leave guard of a notes form, shared by Holistic Post-Session Notes and
// AI Test Insights Session Notes. While `guardNeeded`, leaving the page asks
// `beforeNavigation` first: an in-app link click (a Next `<Link>` never fires
// `beforeunload`) and a Back/Forward step (where the browser has the
// Navigation API) wait for its answer and go on only when it is true; a
// reload, a closed tab or a typed address get the browser's own
// `beforeunload` prompt.

type NotesRouter = ReturnType<typeof useRouter>;
/** True to leave; a promise lets the form save first or ask the user. */
export type BeforeNotesNavigation = () => boolean | Promise<boolean>;
type BrowserNavigation = EventTarget & {
  traverseTo: (key: string) => { committed: Promise<unknown> };
};
type BrowserNavigateEvent = Event & {
  navigationType: string;
  destination: { key: string };
};

function browserNavigation() {
  return (window as typeof window & { navigation?: BrowserNavigation }).navigation ?? null;
}

function clickedNavigationAnchor(event: MouseEvent) {
  const modified = [event.metaKey, event.ctrlKey, event.shiftKey, event.altKey].some(Boolean);
  if (event.defaultPrevented || event.button !== 0 || modified) return null;
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a") ?? null;
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return null;
  return anchor;
}

function followNavigationAnchor(anchor: HTMLAnchorElement, router: NotesRouter) {
  const target = new URL(anchor.href, window.location.href);
  if (target.origin === window.location.origin && !target.pathname.startsWith("/api/")) {
    router.push(`${target.pathname}${target.search}${target.hash}`);
    return;
  }
  window.location.assign(target.href);
}

/**
 * Guards leaving the page while `guardNeeded`. `onLeave`, when given, runs
 * just before an allowed in-app navigation or history step goes on.
 */
export function useNotesNavigationGuard({ beforeNavigation, guardNeeded, onLeave, router }: {
  beforeNavigation: BeforeNotesNavigation;
  guardNeeded: boolean;
  onLeave?: () => void;
  router: NotesRouter;
}) {
  const historyGuardInFlight = useRef(false);
  const replayingHistory = useRef(false);
  const guardNeededRef = useRef(guardNeeded);
  const beforeNavigationRef = useRef(beforeNavigation);
  const onLeaveRef = useRef(onLeave);

  useEffect(() => {
    guardNeededRef.current = guardNeeded;
    beforeNavigationRef.current = beforeNavigation;
    onLeaveRef.current = onLeave;
  }, [beforeNavigation, onLeave, guardNeeded]);

  useEffect(() => {
    const navigation = browserNavigation();
    if (!navigation) return;
    const handleHistoryNavigation = (rawEvent: Event) => {
      const event = rawEvent as BrowserNavigateEvent;
      const cannotGuard = [replayingHistory.current, !guardNeededRef.current,
        !event.cancelable, !event.destination.key].some(Boolean);
      if (event.navigationType !== "traverse" || cannotGuard) return;
      event.preventDefault();
      if (historyGuardInFlight.current) return;
      historyGuardInFlight.current = true;
      const finishGuard = (allowed: boolean) => {
        if (!allowed) {
          historyGuardInFlight.current = false;
          return;
        }
        onLeaveRef.current?.();
        replayingHistory.current = true;
        window.setTimeout(() => {
          try {
            void navigation.traverseTo(event.destination.key).committed.then(() => {
              router.refresh();
            }).catch(() => undefined).finally(() => {
              replayingHistory.current = false;
              historyGuardInFlight.current = false;
            });
          } catch {
            replayingHistory.current = false;
            historyGuardInFlight.current = false;
          }
        }, 0);
      };
      const decision = beforeNavigationRef.current();
      if (typeof decision === "boolean") finishGuard(decision);
      else void decision.then(finishGuard).catch(() => finishGuard(false));
    };
    navigation.addEventListener("navigate", handleHistoryNavigation);
    return () => navigation.removeEventListener("navigate", handleHistoryNavigation);
  }, [router]);

  useEffect(() => {
    if (!guardNeeded) return;
    const handleClick = (event: MouseEvent) => {
      const anchor = clickedNavigationAnchor(event);
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      void Promise.resolve(beforeNavigation()).then((allowed) => {
        if (!allowed) return;
        onLeaveRef.current?.();
        followNavigationAnchor(anchor, router);
      });
    };
    const handleUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", handleClick, true);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [beforeNavigation, guardNeeded, router]);
}
