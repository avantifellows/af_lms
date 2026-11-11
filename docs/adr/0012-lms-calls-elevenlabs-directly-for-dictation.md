# The LMS calls ElevenLabs directly for Dictation

Dictation (issue #500) turns a Holistic Mentor's short spoken clip into text while they wait at the Notes form. An LMS server route sends the clip to ElevenLabs Scribe with a key held by the LMS and returns the text in the same request. This is a deliberate, narrow exception to ADR 0009, which keeps provider keys and AI work in etl-next. etl-next runs one flow at a time behind `master_flow` and has no endpoint a browser can wait on, so it cannot answer a Mentor within seconds.

The exception covers verbatim speech-to-text only. The route sends no prompt, calls no LLM, and stores neither the audio nor a transcript. Any summarising, rewriting, or generation still belongs in etl-next under ADR 0009.

A recording is capped at two minutes so that one call is expected to fit inside Amplify's ~30 s request limit. That has not been measured yet and must be checked when the route is built.

## Considered Options

- **Queue the clip through etl-next, as Blended Learning does.** Rejected: the queue is serial and can sit behind `master_flow`, so text could arrive minutes later while the Mentor is waiting at the form.
- **ElevenLabs Scribe Realtime from the browser, so text appears while speaking.** Rejected for v1: it costs more per audio hour, needs the browser to stream raw PCM over a WebSocket, and the LMS would still hold a key to issue the single-use tokens. Text right after stopping meets the request.
- **The browser's built-in speech recognition.** Rejected: support differs by browser, and on Chrome the audio goes to Google under terms we do not control. Using ElevenLabs keeps one speech provider across Blended Learning and Holistic Mentorship.

## Consequences

- The LMS holds its first external provider key. It is a server-only environment variable and is never sent to the browser.
- ElevenLabs zero retention is enterprise-only and the account is not enterprise yet. Dictation launches without it, behind a setting that turns zero retention on once the account supports it, as Blended Learning transcription already has. Until then the provider's standard retention applies to Dictation audio, and `CONTEXT.md` says so.
- A clip the Mentor abandons still counts toward their thirty minutes a day. The Dictation Usage Record is written before the ElevenLabs call, and the route lets that call finish even when the Mentor has left the page, closed the Follow-up Note form, or saved in the meantime. The text is thrown away and the seconds stay counted. This keeps one rule: every clip the route sends to ElevenLabs counts, whatever happens next. Cancelling the call would not reliably save money, because ElevenLabs may bill a call that is cut off midway, and it would need a fourth outcome in the usage table. A recording dropped before it is sent (Cancel, Escape, or leaving while still recording) is never uploaded and does not count.
- Dictation audio is speech about minors. The LMS keeps no copy, and the Dictation Usage Record holds no Student, Question, text, or audio.
