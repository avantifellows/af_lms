---
name: review-with-agents
description: How to run agent reviewers on an af_lms change and handle what they find. Independent lenses plus a second model family, a bar for calling a finding verified, a plain-words walkthrough where a person decides, a decided list so later rounds don't repeat, when to stop, how to post, and how to answer review comments.
triggers:
  - "review with agents"
  - "sub-agent review"
  - "codex review"
  - "address review comments"
  - "re-review"
edges:
  - target: patterns/pre-pr-review.md
    condition: for what a review must check (CI, base vs branch, numbers, exposure, audience, docs, other repos)
  - target: patterns/local-browser-qa.md
    condition: when reproducing a finding in the browser
  - target: context/data-access.md
    condition: when counting a finding's real impact in BigQuery
last_updated: 2026-10-28
---

# Reviewing with agents

`pre-pr-review.md` says what a review must check. This file says how to run the reviewers and what to do with
their findings, on your own PR, on a teammate's, or when answering comments on yours. "Author", "owner" and
"person running the review" mean what `pre-pr-review.md`'s **Roles** says.

**A finding is a claim until it's proven.** Reviewers, including a second model, are often confidently wrong:
wrong line numbers, a misread type, a "high severity" bug that real data shows can't happen. Nothing a reviewer
says reaches the PR until someone has checked it against the code and the data.

## 1. Brief the reviewers, and show the brief first

- Reviewers are **read-only**: no edits, commits, pushes or GitHub comments, and no secrets or student data written
  to disk. Say what data access is allowed (for example SELECT-only BigQuery; no AWS, production or staging commands).
- Run them on a **frozen commit**: a worktree pinned to the PR head. Don't fix anything until every reviewer has
  reported. On etl-next #192 two reviewers read uncommitted edits made mid-review.
- Each brief gives:
  - the lens, and where the other lenses stop;
  - `AGENTS.md`'s non-negotiables;
  - the PR's own claims, to be checked rather than trusted;
  - what is already decided (§5);
  - the report shape: severity (P0 to P3), `file:line`, the failure (inputs → wrong outcome), a fix, each finding
    marked **CONFIRMED** or **PLAUSIBLE**, a "checked and fine" list, and a word cap.
- **Show the brief to the person running the review before launching.** They often know what the reviewers should
  skip or look harder at.
- A brief that names a "prime suspect" anchors every reviewer on it. Give at least one reviewer only the diff and
  the PR text.

## 2. Pick the reviewers

- **2 to 5 lens reviewers in parallel**, each with one lens (a small PR, as `pre-pr-review.md` step 0 defines it,
  can use one). Lenses that have earned their place:
  - correctness and security;
  - cross-repo contracts (db-service, etl-next, CMS, env vars);
  - data and SQL: run the real query with real parameters, SELECT only;
  - UI, forms and validation;
  - a test runner for `pre-pr-review.md` step 2;
  - optionally, "what can be deleted" (over-engineering). Its findings are refactors, not defects; see §5 before
    acting on one.
- **One run of a second model family** (for example Codex at high effort) on the same commit. Name the model and the
  effort explicitly, and send a one-line smoke prompt first: on #466 and db-service #804 the run failed on an
  unsupported model. Codex found what the Claude lenses missed on #456, #466 and etl-next #190.
- On your own PR, the session that wrote the code doesn't review it.

## 3. Verify every finding before anyone sees it

The consolidator, the session that launched the reviewers, checks each finding itself. "The sub-agents checked it"
is not a check.

- **CONFIRMED means all of these:**
  - the runtime path is traced from the page or route to the line;
  - the real config and env are checked, not assumed;
  - it is reproduced on the branch (SQL, a script, the browser, or a failing test), and the base is checked: if the
    base does it too, the finding is labelled inherited.
- Re-reading the diff is not verification. Don't write "may" or "might": the code gives a definite answer, so read it
  until it does.
- **Reachability.** Can a user reach it from the UI, or a real caller from its route? If only a call nobody makes
  triggers it, drop it and say why. "If someone later calls this directly" is not a finding.
- **Impact in data.** Count the affected rows (SELECT only) before accepting a finding. Measuring can also downgrade
  one: a "missing partition filter" scanned 10 MB, so it was dropped.
- **Product intent beats the reviewer.** If the PR or the issue says the behaviour is by design, it isn't a finding.
  If it's unclear, it becomes a question for the owner.
- **Keep or discard each finding, with a one-line reason.** Two reviewers, or both model families, raising the same
  thing is stronger evidence, not proof. A finding only one reviewer raised is often the valuable one. Expect to keep
  a third to a half.
- If a reviewer returned nothing, or seems to have failed, read its whole output before reporting "clean" or
  "failed".

## 4. Walk the person running the review through it

- Report in chat first: the verdict, then the kept findings by severity, numbered `n/total`.
- Each finding, in plain words: current behaviour, expected behaviour, the real impact on a user, and a
  recommendation. Go one at a time when the person asks for it. They decide each one: fix now, post, ask as a
  question, follow-up issue, or drop.
- **A review changes nothing.** No edits, commits or comments until the person says go.

## 5. Fixes, and the decided list

- Each fix comes with a test that fails without it.
- **Never make a check pass by weakening it:** no ignore flags, suppressions, loosened assertions or skipped tests.
  If the check itself is wrong, say so and ask.
- Before applying a clean-up that deletes code, list what it removes. On db-service #806 an over-engineering trim
  removed a cross-student privacy test, a second round asked "was anything over-trimmed?" and said no, and a
  teammate caught it.
- **Write every decision down** (accepted risk, by design, deferred) in the PR description or the issue, so the next
  review round doesn't raise it again. Put deferred items in one follow-up issue.

## 6. Re-review, and when to stop

- Give each reviewer the earlier findings, the author's replies and the decided list: "these were fixed or decided;
  don't raise them again unless a fix is itself wrong".
- For each earlier finding, re-run its repro and mark it fixed, partly fixed, not fixed or regressed. Don't take the
  reply's word for it.
- Run a fresh pass alongside: on #405 the blocker's fix introduced a new regression. Check no permission check was
  dropped.
- **Stop at decision closure, not at zero findings.** A reviewer always finds something. Stop when no P0 or P1 is
  open, what's left repeats decided points or is a nit, and every risky path has a test. Set a round budget up front
  (three is usually enough). A reviewer that finds nothing doesn't need another run on the same commit.

## 7. Posting

- **Nothing goes on GitHub without the go of the person running the review.** Draft in chat, get an "ok", then post.
- One comment per finding, inline on the affected line where possible, in the shape of `pre-pr-review.md`'s report,
  with ids replaced by descriptions. Nits go in one "none blocking" comment. Uncertain points are asked as
  questions. A known risk the team has accepted is stated as accepted.
- Plain and specific. Length is fine if it carries the issue, how it was verified, and the proposed fix. No first
  person ("I noticed") and no filler.
- The same issue on another PR gets one line linking to the first comment.
- After posting, open the comment's URL to check it exists. A tool reporting success is not proof.
- af_lms is public: no student or school names or ids, and blur screenshots before attaching them.
- When nothing blocking is left, approve with "LGTM". Delete or minimise stale automated comments.

## 8. Answering review comments, from people or bots

- Treat each comment as a claim. Read the code it points at, verify it as in §3, and form a view. Don't fix blindly.
- List the comments in plain words with **Accept / Reject / Ask** and a recommendation for each. The owner decides
  before anything is fixed.
- Accepted: fix it with a test, reply "Fixed in `<sha>`", resolve. Rejected: reply with the reason, then resolve.
  Ask: reply with the question and leave the thread open.
- `@codex review`: re-trigger it after a round of fixes. When it repeats a point already rejected, reply with the same
  reason. It doesn't stop on its own, so the round budget from §6 applies. Once a run finds nothing, don't trigger
  it again.
- After the last fix, update the PR description so it lists only what the code now does.
