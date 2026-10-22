"use client";

import { useEffect } from "react";

// Records this visit to the Flags tab once the feed has rendered, so the
// flags highlighted as new stay highlighted until the next visit.
export function MarkFlagsSeen() {
  useEffect(() => {
    fetch("/api/blended-learning/flags/seen", { method: "POST" }).catch(() => {
      // Best effort: the badge simply stays until a later visit is recorded.
    });
  }, []);
  return null;
}
