"use client";

import { useEffect } from "react";

// Records a new visit to the Flags tab once the feed has rendered. The page
// renders it only when the admin enters the tab; filter and page changes
// carry the visit's cutoff instead, so the same flags stay New all visit.
export function MarkFlagsSeen() {
  useEffect(() => {
    fetch("/api/blended-learning/flags/seen", { method: "POST" }).catch(() => {
      // Best effort: the badge simply stays until a later visit is recorded.
    });
  }, []);
  return null;
}
