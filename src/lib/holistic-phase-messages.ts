// Shared by the server (the Mentor write scope) and the Mentor screen, which
// recognises this refusal to stop saving. Keep it free of server-only imports.
export const HOLISTIC_PHASE_CLOSED_ERROR =
  "This Phase is closed. Notes can be added or changed only in the Active Phase.";

// Returned (409) when an Admin confirms opening a Phase after the Phase that
// would close has changed, and recognised by Phase Setup, which then reloads.
export const HOLISTIC_CLOSING_PHASE_CHANGED_ERROR =
  "The Open Phases for this Grade changed while you were confirming, so nothing was opened. The Plan below is now up to date. Check it, then open the Phase again if you still want to.";
