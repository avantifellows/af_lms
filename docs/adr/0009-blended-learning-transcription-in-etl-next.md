# Blended Learning call transcription and drafting run in etl-next

A Blended Learning Mentor's uploaded Call Recording is transcribed (ElevenLabs Scribe) and turned into a Conversation Draft (OpenRouter) by an etl-next flow, not by the LMS. The LMS records a queued transcription request and wakes the ETL drainer, the same way Holistic Profile regeneration works (ADR 0005), and etl-next writes the draft back through a db-service API. This keeps every LLM and prompt in etl-next, with its zero-data-retention routing, prompt versioning and cost controls, and keeps provider keys out of the LMS. The cost is latency: etl-next runs one flow at a time, so a draft can wait behind `master_flow`. That is why the draft is a separate Conversation Draft that the Mentor reviews later, rather than something the log form waits for.

## Considered Options

- **Async in the LMS, using an ElevenLabs webhook and an OpenRouter call in a webhook route.** Rejected, although it was less code and gave a draft in about a minute regardless of the ETL queue: it would put the LMS's first LLM, webhook and provider-key code outside the place where all other mentorship AI work lives.
- **A synchronous call inside an LMS request.** Rejected: a 20–40 minute recording does not reliably finish inside Amplify's ~30 s request limit.
