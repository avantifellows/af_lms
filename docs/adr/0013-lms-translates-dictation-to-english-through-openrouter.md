# The LMS translates Dictation into English through OpenRouter

Status: accepted, 2026-11-16 (owner decision). Amends ADR 0012. A stated exception to ADR 0009.

Dictation text must always be English. Many Mentors, and many people who read the Notes, speak Hindi but cannot read Devanagari, so a Hindi transcript is of no use to them. The English must be a complete translation of what was said, never a summary.

ElevenLabs Scribe v2 still transcribes the clip. When Scribe reports English (`language_code` `eng` or `en`) and the transcript has no letter outside the Latin script, the transcript is returned unchanged and no LLM is called. Otherwise the LMS sends the transcript text to OpenRouter in one chat completion and returns the English reply. The default model is `openai/gpt-6.1-terra`, set by `HOLISTIC_DICTATION_TRANSLATION_MODEL`. Reasoning is off, and requests use zero-retention routing only (`provider: {zdr: true, data_collection: "deny"}`), with no fallback without it. The prompt is one fixed instruction in `src/lib/openrouter-translate.ts`, with a version id that changes whenever the text does. It drops hesitation sounds (uh, um) and nothing else.

The reply is used only if it finished normally, is not empty, has at most 1% of its letters outside the Latin script, and, for inputs over 200 characters, is between 0.5 and 2.0 times the input's length. A failed attempt is retried once if at least 5 s remain. Scribe and translation share one 27 s deadline: Scribe keeps its own 25 s cap, and each translation attempt gets min(15 s, time left). As in ADR 0012, none of this is tied to the request's signal. If the translation fails, the clip fails exactly like a failed transcription, with the same response and Retry. The untranslated transcript is never returned to the browser.

Dictation is on only when `HOLISTIC_DICTATION_ENABLED=true` and both `HOLISTIC_DICTATION_ELEVENLABS_API_KEY` and `HOLISTIC_DICTATION_OPENROUTER_API_KEY` are set.

## Why the LMS calls the LLM itself

ADR 0009 keeps LLM calls and prompts in etl-next. ADR 0012 allowed the LMS to call ElevenLabs only for verbatim speech-to-text, with no LLM. This decision departs from both, for one narrow case:

- The translation has to finish inside the Mentor's own request, within seconds. etl-next is a batch orchestrator that runs one flow at a time and has no endpoint a browser can wait on.
- The prompt is one small fixed instruction, not a managed prompt catalogue.
- Nothing is stored: no audio, transcript, or translation.

Any other LLM work, such as summarising or generating text, still belongs in etl-next under ADR 0009.

## Considered Options

- **Ask ElevenLabs for English.** Not possible. Its docs say Scribe does not translate. A real test of its `transcript_edit` option on 2026-11-16 translated a Hinglish clip but returned a Hindi clip unchanged, with no error.
- **Translate in etl-next.** Rejected for the latency reasons above, the same as ADR 0012.
- **Return the transcript as is, in whatever script Scribe uses.** Rejected: it is the problem this decision fixes.
- **Leave reasoning on.** Rejected: in the trial, models were 2 to 5 times slower with reasoning on, with no gain in quality.
- **A cheaper model.** Possible later. `deepseek/deepseek-v4.1-flash` (9.0 and 9.0) and `anthropic/claude-haiku-5.5` (8.7 and 9.0) scored slightly below the default.

## Evidence

A trial on 2026-11-16 ran two real recordings and one input joining them through 14 models via OpenRouter, three runs each. Every model produced complete English, and every output passed the automatic checks. `openai/gpt-6.1-terra` with reasoning off had the top blind-judge scores (9.3 and 9.7 out of 10, no omissions flagged). On a 2,465-character Hindi and Hinglish input it took 3.7 s median and 4.0 s worst, and cost about US$0.0034 per translation. Scribe took 3 to 7 s for clips of 1:17 to 4:46, so a five-minute Hindi clip is expected to take about 13 s end to end. Scribe costs about US$0.20 per audio hour.

The sample is small. It is not a guarantee of quality on all speech.

## Consequences

- Note text, which can include details about Students who are minors, is now sent as text to OpenRouter and on to the model host, under zero-retention routing. Audio still goes only to ElevenLabs. ElevenLabs zero retention is still off on staging (Enterprise-only), as before.
- The LMS holds a second provider key, `HOLISTIC_DICTATION_OPENROUTER_API_KEY`, server-only like the ElevenLabs key.
- The code hard-codes `reasoning: {effort: "none"}`. A replacement model must support thinking off, or the code needs a small change.
- The Dictation Usage Record gains two content-free columns: `detected_language` (Scribe's code, lower-case, nullable) and `translation` (`not_run`, `skipped`, `ok` or `failed`). They come from db-service migration `20261116113700_add_translation_to_holistic_dictation_usage_records` (db-service PR #858), a second migration because the first is already applied on staging. The LMS must not be deployed with this code before that migration is applied, because it writes the new columns.
- A translated clip counts toward the thirty minutes a day like any other, and a failed translation counts too, as in ADR 0012.
- Not measured yet: a full five-minute Hindi clip on Amplify, quality on a larger set of real recordings, and Safari or iPhone.
