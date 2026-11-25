---
name: add-deploy-setting
description: Adding a server-side environment variable that deployed apps (staging previews and production) must receive through the Amplify workflow.
triggers:
  - "new env var"
  - "environment variable"
  - "deploy-amplify"
  - "amplify.yml"
  - "GitHub secret"
edges:
  - target: context/setup.md
    condition: for the existing variable list and the e2e web-server overrides
  - target: patterns/deploy-staging-pr.md
    condition: when the new setting has to be live on shared staging for QA
last_updated: 2026-11-16
---

# Add a deploy setting

## Context
Each Amplify job in `.github/workflows/deploy-amplify.yml` replaces the branch's whole variable set with
`aws amplify update-branch --environment-variables`. A name missing from a job is wiped on that job's next
deploy. `amplify.yml` then writes each variable into `.env.production`, which is what the running app reads.
There are three jobs: `deploy-manual-preview`, `deploy-preview` and `deploy-production`.

## Steps
1. In **each of the three jobs**, add the name in three places, next to its related settings:
   the step's `env:` block (`NAME: ${{ secrets.NAME }}`), a `--arg <short_name> "$NAME"` line, and a
   `NAME: $<short_name>,` line in the jq object.
2. Add `echo "NAME=$NAME" >> .env.production` to `amplify.yml`, next to its related settings.
3. Add the name with a blank or safe value and a short comment to `.env.example`, `.env.staging.example`
   and `.env.production.example`. Never put a real value in any example file.
4. List it in `context/setup.md`, with what happens when it is blank.
5. Tell the owner which GitHub environment secrets to set (`Preview` for staging, `Production`). Setting
   them is the owner's job, not a code change.

## Gotchas
- A secret that isn't set arrives as an empty string, and `amplify.yml` writes `NAME=` into
  `.env.production`. The code must treat a blank (after trimming) like unset: off, or the default. For
  example, `HOLISTIC_DICTATION_TRANSLATION_MODEL` falls back to its default model when blank.
- A required setting that is blank should switch its feature off, not crash the build or the page.
- The Playwright web server sets some variables to `" "` on purpose (a truly blank value would be refilled
  from `.env.local`). Check `playwright.config.ts` before relying on a blank in e2e.

## Verify
- [ ] YAML still parses: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-amplify.yml')); yaml.safe_load(open('amplify.yml'))"`.
- [ ] `grep -c NAME .github/workflows/deploy-amplify.yml` is 9 (three places × three jobs), and matches the
      count for a neighbouring setting.
- [ ] Each job's `env:` names, `--arg` names and jq object names are the same set.
- [ ] `grep -c NAME amplify.yml` is 1.

## Debug
- Feature off on staging after a deploy: the name is missing from the job that ran, or the GitHub
  environment secret is unset. Check the Amplify branch's environment variables in the console.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
