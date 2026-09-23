---
name: deploy-staging-pr
description: Restore a reviewed LMS PR to shared staging and verify its deployment and database routing.
last_updated: 2026-09-23
---

# Deploy a PR for staging QA

1. Confirm the requested PR head and checks with `gh pr view`. Read `.github/workflows/deploy-amplify.yml`; all PR previews use the shared staging branch and URL, so the latest successful PR check does not prove its code is currently live.
2. For an already-built PR, rerun only its `deploy-preview` job using `gh run rerun RUN_ID --job JOB_ID`. This uses the existing CI workflow to synchronize PR code and Preview configuration. Do not rerun the production job or invent a local deployment path.
3. Inspect Amplify staging jobs for app `dr1eqhpsk9y2d` in `ap-south-1`. Wait for BUILD, DEPLOY, and VERIFY success, and compare the deployed commit with the requested head (or verify the source tree if CI used a merge commit). CI finishing only means the asynchronous Amplify job was triggered.
4. Compare effective Amplify app-plus-branch database settings with production in memory; never output credentials. Check the staging DB Service task configuration too. Backend RDS proxy DNS may differ from LMS direct RDS DNS: verify `describe-db-proxy-targets` resolves the proxy to the same instance/port/database before treating that difference as a problem.
5. Perform an HTTP smoke check, record the deployed SHA/job and verified database routing, and share `https://staging.dr1eqhpsk9y2d.amplifyapp.com`. State which PR is ready; DB Service deployment is a separate step when testing one PR at a time.
6. Record the handoff in ROUTER and student-addition context. Staging shares one URL and another PR deployment can replace it.

## DB Service follow-up

Dispatch sibling `staging_deploy_ecs.yml` from main with the full 40-character reviewed PR SHA in its `ref` input. Abbreviated SHAs are interpreted as branch/tag names by actions/checkout and fail before deployment. If GitHub reports waiting, inspect the run pending_deployments endpoint: `staging-ecs` requires reviewer approval. When deployment is user-authorized and the authenticated user is an allowed reviewer, approve that specific staging environment through the API. The workflow builds the tagged image, runs the normal migration task, rolls ECS, and smoke-checks health; it does not run the separate historical timestamp repair. Confirm successful workflow, completed ECS rollout, and the expected image on every running service task before handoff. Ask for the staging test student ID so baseline timestamps can be captured before user mutations.
