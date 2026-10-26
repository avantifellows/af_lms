# Blended Learning call recordings are kept six months and only admins can play them

Call Recordings are calls with minors, often with a parent on the line. The audio and its raw transcript are kept for six months in a private prefix of the documents bucket. Only Blended Learning Admins can play or read them in the app, including read-only admins. The Mentor who uploaded a recording cannot replay it after saving. An S3 lifecycle rule enforces the six months: current objects expire after 180 days and noncurrent versions after one day, because the bucket is versioned and would otherwise keep copies for 90 more days. No app code deletes recordings. Keeping them leaves admins a way to check a disputed or flagged Conversation against what was actually said. The six-month limit and admin-only access keep that exposure bounded.

## Considered Options

- **Keep nothing raw:** delete the audio on save, store no transcript, and allow no playback. This has the smallest privacy surface, but leaves nothing to check a Conversation against.
- **Keep indefinitely, or let Mentors replay.** Rejected: it means more retained data about minors than v1 needs.
