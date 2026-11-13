// Client-safe: how long one Dictation (#500) recording may run, shared by the
// browser recorder and the server. Five minutes, by owner decision (2026-11-13).

// The browser stops a recording here, or sooner at the Mentor's time left today.
export const HOLISTIC_DICTATION_MAX_RECORDING_SECONDS = 300;

// The longest clip the server accepts and counts: the recording cap plus 5 s
// of client timer slop. db-service's usage table checks the same 305 s.
export const HOLISTIC_DICTATION_MAX_CLIP_SECONDS = HOLISTIC_DICTATION_MAX_RECORDING_SECONDS + 5;
