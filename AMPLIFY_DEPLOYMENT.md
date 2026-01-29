# AWS Amplify Deployment with GitHub Secrets

## Overview

Deploy the Next.js LMS app to AWS Amplify with environment variables managed in GitHub Secrets. GitHub Actions syncs secrets to Amplify and triggers builds.

**Why this approach:**
- Single source of truth for secrets (GitHub)
- Amplify handles SSR optimizations and caching
- Auto-deploy on push to main
- Easy to rotate secrets without touching AWS Console

---

## Architecture

```
GitHub Push → GitHub Actions → Sync Env Vars to Amplify → Trigger Amplify Build → Deploy
```

---

## Implementation Steps

### Step 1: Create Amplify App in AWS Console

1. Go to https://console.aws.amazon.com/amplify/
2. Click **"Create new app"** → **"Host web app"**
3. Select **GitHub** → Authorize AWS → Select `af_lms` repo, `main` branch
4. **Important:** In build settings, keep defaults (Amplify auto-detects Next.js)
5. **Skip adding env vars** for now (GitHub will manage them)
6. Click **"Save and deploy"** — first deploy will fail (no env vars), that's OK
7. Copy the **App ID** from the URL: `https://console.aws.amazon.com/amplify/home#/d1234abcdef/...`
   - The App ID is `d1234abcdef` (the part after `#/`)

### Step 2: Create AWS IAM User for GitHub Actions

1. Go to AWS IAM Console → Users → Create user
2. Name: `github-actions-amplify`
3. Attach policy: `AdministratorAccess-Amplify` (or create custom policy below)
4. Create access key → Select "Application running outside AWS"
5. Save `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

**Custom policy (least privilege):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "amplify:UpdateApp",
        "amplify:StartJob",
        "amplify:GetApp",
        "amplify:GetBranch"
      ],
      "Resource": "arn:aws:amplify:*:*:apps/YOUR_APP_ID/*"
    }
  ]
}
```

### Step 3: Add GitHub Secrets

Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `AWS_ACCESS_KEY_ID` | From IAM user |
| `AWS_SECRET_ACCESS_KEY` | From IAM user |
| `AWS_REGION` | e.g., `ap-south-1` |
| `AMPLIFY_APP_ID` | From Step 1 |
| `DATABASE_HOST` | Your DB host |
| `DATABASE_PORT` | e.g., `5432` |
| `DATABASE_USER` | Your DB user |
| `DATABASE_PASSWORD` | Your DB password |
| `DATABASE_NAME` | Your DB name |
| `GOOGLE_CLIENT_ID` | From Google Console |
| `GOOGLE_CLIENT_SECRET` | From Google Console |
| `NEXTAUTH_SECRET` | Random 32+ char string |
| `NEXTAUTH_URL` | Amplify URL (update after first successful deploy) |

### Step 4: Create GitHub Actions Workflow

Create file `.github/workflows/deploy-amplify.yml`:

```yaml
name: Deploy to AWS Amplify

on:
  push:
    branches:
      - main
  workflow_dispatch:  # Allow manual trigger

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Sync environment variables to Amplify
        run: |
          aws amplify update-app \
            --app-id ${{ secrets.AMPLIFY_APP_ID }} \
            --environment-variables "\
              DATABASE_HOST=${{ secrets.DATABASE_HOST }},\
              DATABASE_PORT=${{ secrets.DATABASE_PORT }},\
              DATABASE_USER=${{ secrets.DATABASE_USER }},\
              DATABASE_PASSWORD=${{ secrets.DATABASE_PASSWORD }},\
              DATABASE_NAME=${{ secrets.DATABASE_NAME }},\
              GOOGLE_CLIENT_ID=${{ secrets.GOOGLE_CLIENT_ID }},\
              GOOGLE_CLIENT_SECRET=${{ secrets.GOOGLE_CLIENT_SECRET }},\
              NEXTAUTH_SECRET=${{ secrets.NEXTAUTH_SECRET }},\
              NEXTAUTH_URL=${{ secrets.NEXTAUTH_URL }}"

      - name: Trigger Amplify build
        run: |
          aws amplify start-job \
            --app-id ${{ secrets.AMPLIFY_APP_ID }} \
            --branch-name main \
            --job-type RELEASE

          echo "Build triggered! Check status at:"
          echo "https://console.aws.amazon.com/amplify/home#/${{ secrets.AMPLIFY_APP_ID }}/main"
```

### Step 5: Disable Amplify Auto-Build (Optional)

To prevent double builds (Amplify webhook + GitHub Actions):

1. Go to Amplify Console → Your app → Hosting → Build settings
2. Click **"Edit"** on the branch
3. Toggle off **"Automatically build on push"**

Now only GitHub Actions triggers builds.

### Step 6: Update NEXTAUTH_URL After First Deploy

1. After successful deploy, get your Amplify URL (e.g., `https://main.d1abc2xyz.amplifyapp.com`)
2. Update `NEXTAUTH_URL` secret in GitHub with this URL
3. Trigger another deploy (push or manual)

### Step 7: (Optional) Add Custom Domain

1. Amplify Console → Your app → Hosting → Domain management
2. Add your custom domain
3. Update `NEXTAUTH_URL` secret to custom domain
4. Update Google OAuth redirect URIs in Google Console

---

## Verification

1. Push a commit to `main` branch
2. Go to GitHub → Actions tab → Watch workflow run
3. Check Amplify Console for build progress
4. Visit Amplify URL → Verify app loads
5. Test Google OAuth login
6. Test database connection (view students)

---

## Rollback

If a deploy breaks:
1. Amplify Console → Your app → Select branch
2. Click on a previous successful build
3. Click **"Redeploy this version"**

---

## PR Preview Deployments

Get temporary preview URLs when opening PRs (like Vercel).

### Recommended: Hybrid Approach

- **Production (`main`):** GitHub Actions syncs secrets → Amplify builds
- **PR Previews:** Amplify's built-in preview feature

### Setup PR Previews

1. Go to Amplify Console → Your app → **Previews**
2. Click **"Enable previews"**
3. Install the Amplify GitHub App when prompted
4. Add environment variables in Amplify Console for previews:
   - Go to **Hosting** → **Environment variables**
   - Add all the same env vars (these are used for preview branches)

### How It Works

| Event | Handler | URL |
|-------|---------|-----|
| Push to `main` | GitHub Actions | `https://main.d1abc.amplifyapp.com` |
| Open PR | Amplify Previews | `https://pr-123.d1abc.amplifyapp.com` |
| Close PR | Amplify | Preview auto-deleted |

### Preview URL Format

```
https://pr-{PR_NUMBER}.{APP_ID}.amplifyapp.com
```

Example: PR #42 → `https://pr-42.d1abc2xyz.amplifyapp.com`

### Note on Secrets for Previews

Since PR previews use Amplify's built-in feature, they read env vars from Amplify Console (not GitHub Secrets). You have two options:

1. **Same env vars:** Add production secrets to Amplify Console (OK for internal tools)
2. **Separate test env:** Create a test database and use those credentials in Amplify Console for previews

---

## Cost Estimate

For low-traffic internal tool:
- GitHub Actions: Free (2,000 min/month)
- Amplify: Free tier (1,000 build min, 5GB storage, 15GB transfer)
- **Total: $0/month**
