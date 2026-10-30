# Visit Concerns are durable records, matched visit by visit in etl-next, and reopen on their own

Visit Concerns and Visit Highlights on the School Visit Summary are stored as permanent records with stable ids, not regenerated summaries. An etl-next flow, run three times a day, reads each newly completed Visit's free text (through db-service) and asks the LLM, which sees that School's existing Concern and Highlight list, to attach each point to an existing record or create a new one. Existing records are never rewritten. Concern Resolutions, comments and reopens hang off the id in an append-only history, so they survive every later run. A resolved Visit Concern reopens automatically when a Visit dated after its resolution mentions it again; earlier Visits processed late never reopen it. Like ADR 0009, this keeps the LLM, prompts and provider keys in etl-next, and the LMS only reads the records and writes the resolution history.

## Considered Options

- **Regenerate each School's summary on every run and re-match old ids to the new themes.** Rejected: theme wording drifts between runs, so resolutions detach or land on the wrong theme. The #470 preview keyed resolutions on concern text and lost them this way.
- **No grouping in v1 (each Remark shown as its own item).** Rejected: without grouping there is no Recurring Concern, which is the point of the feature.
- **Call the LLM from the LMS.** Rejected for the reasons in ADR 0009.
- **Keep a resolved Concern resolved when it is mentioned again, with a badge, or start a new Concern.** Rejected: a problem that returns after a fix is what managers most need to see, and a new Concern loses the record that it was fixed once.

## Consequences

- There are no edit, merge or dismiss tools in v1. A wrongly classified or duplicate Concern is resolved with a comment, and can auto-reopen if a later Visit matches it again.
- Matching quality depends on the LLM. A missed match creates a duplicate Concern and splits the visit count, so Recurring counts are only as good as the matching.
