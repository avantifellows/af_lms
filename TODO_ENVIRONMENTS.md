# Setting Up Staging and Production Environments

## Status

| Item | Status |
|------|--------|
| Production database credentials | ✅ Done |
| Production DB service URL | ✅ Done |
| Production DB service token | ✅ Done |
| Vercel setup decision | ✅ Option A (two projects) |
| Domain names | ✅ Production: `lms.avantifellows.org` |
| Production deployment | ✅ Done (2024-12-02) |
| DNS configuration | ✅ Done |

---

## Current State

- **Staging project**: `af-lms` (project ID: `prj_LJ0wts95AR2LEqJF9a4MQNhSKMrZ`)
- **Production project**: `af-lms-production` ✅ Created
- **Production URL**: https://af-lms-production.vercel.app (temporary)
- **Production domain**: `lms.avantifellows.org` (pending DNS)
- **Local repo linked to**: `af-lms` (staging)

### DNS Configuration Required

Add this DNS record in Cloudflare (or your DNS provider):

| Type | Name | Value |
|------|------|-------|
| A | lms | 76.76.21.21 |

Or alternatively use a CNAME:

| Type | Name | Value |
|------|------|-------|
| CNAME | lms | cname.vercel-dns.com |

---

## Deployment Plan

### Recommendation: Two Vercel Projects

Using two separate Vercel projects is the cleanest approach because:
1. **Isolated environment variables** - No risk of staging vars leaking to production
2. **Independent deployments** - Can deploy to staging without affecting production
3. **Clear separation** - Easy to manage via CLI with `--scope` or project linking
4. **Branch-based deploys** - Staging can auto-deploy from all branches, production only from `main`

### Project Naming
| Environment | Vercel Project Name | Domain |
|-------------|---------------------|--------|
| Staging | `af-lms` (existing) | `af-lms.vercel.app` (or custom staging domain later) |
| Production | `af-lms-production` | `lms.avantifellows.org` |

---

## Deployment Steps (CLI-based)

### Phase 1: Prepare Production Project

```bash
# Step 1.1: Create new Vercel project for production
vercel project add af-lms-production

# Step 1.2: Link this repo to production project (temporarily)
vercel link --project af-lms-production

# Step 1.3: Set production environment variables
vercel env add DATABASE_HOST production
vercel env add DATABASE_PORT production
vercel env add DATABASE_USER production
vercel env add DATABASE_PASSWORD production
vercel env add DATABASE_NAME production
vercel env add DB_SERVICE_URL production
vercel env add DB_SERVICE_TOKEN production  # <-- BLOCKED: waiting on admin
vercel env add NEXTAUTH_URL production
vercel env add NEXTAUTH_SECRET production
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production

# Step 1.4: Deploy to production
vercel --prod

# Step 1.5: Add custom domain
vercel domains add lms.avantifellows.org
```

### Phase 2: Configure DNS

After adding domain in Vercel, configure DNS at your registrar:
- **Option A (Recommended)**: CNAME record pointing to `cname.vercel-dns.com`
- **Option B**: A record pointing to Vercel's IP (76.76.21.21)

### Phase 3: Update Google OAuth

Add to Google Cloud Console OAuth settings:
- Authorized origin: `https://lms.avantifellows.org`
- Redirect URI: `https://lms.avantifellows.org/api/auth/callback/google`

### Phase 4: Database Setup

Run against production database:
```sql
-- Create permissions table if not exists
CREATE TABLE IF NOT EXISTS user_permission (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3, 4)),
  school_codes TEXT[],
  regions TEXT[],
  read_only BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add initial admin
INSERT INTO user_permission (email, level) VALUES
  ('admin@avantifellows.org', 4)
ON CONFLICT (email) DO NOTHING;
```

### Phase 5: Switch Back to Staging

```bash
# Re-link to staging project for day-to-day development
vercel link --project af-lms
```

---

## Environment Variable Values

### Staging (af-lms)
| Variable | Value |
|----------|-------|
| DATABASE_HOST | staging-af-db.ct2k2vwmh0ce.ap-south-1.rds.amazonaws.com |
| DATABASE_PORT | 1357 |
| DATABASE_USER | postgres |
| DATABASE_NAME | staging_af_db |
| DB_SERVICE_URL | https://staging-db.avantifellows.org/api |
| NEXTAUTH_URL | https://af-lms.vercel.app (or staging domain) |

### Production (af-lms-production)
| Variable | Value |
|----------|-------|
| DATABASE_HOST | af-database.ct2k2vwmh0ce.ap-south-1.rds.amazonaws.com |
| DATABASE_PORT | 1357 |
| DATABASE_USER | postgres |
| DATABASE_NAME | prod_af_db |
| DB_SERVICE_URL | https://db.avantifellows.org/api |
| NEXTAUTH_URL | https://lms.avantifellows.org |

---

## Blocker

⚠️ **Cannot proceed with production deployment until `DB_SERVICE_TOKEN` is provided by admin.**

This token is required for the app to communicate with the DB service API for operations like:
- Creating/updating students
- Managing enrollments
- Passcode authentication

---

## Environment Files Reference

```
.env.example              # Generic template for local development
.env.staging.example      # Reference for staging Vercel project
.env.production.example   # Reference for production Vercel project
```

---

## Setup Steps (Legacy - keeping for reference)

### Step 1: Create Vercel Projects

#### Staging Project
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Import the GitHub repo (if not already done)
3. Name it: `crud-ui-staging` (or similar)
4. Set environment variables from `.env.staging.example`

#### Production Project
1. Create new project in Vercel
2. Link to the **same GitHub repo**
3. Name it: `crud-ui-production` (or similar)
4. Set environment variables from `.env.production.example`
5. Configure to deploy from `main` branch only

### Step 2: Set Environment Variables in Vercel

For each project, add these in **Settings > Environment Variables**:

```
DATABASE_HOST
DATABASE_PORT
DATABASE_USER
DATABASE_PASSWORD
DATABASE_NAME
DB_SERVICE_URL
DB_SERVICE_TOKEN
NEXTAUTH_URL
NEXTAUTH_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

Generate `NEXTAUTH_SECRET` with:
```bash
openssl rand -base64 32
```

### Step 3: Create Permission Table in Production

Run against production database:

```bash
# Option 1: Use the setup script
# First, temporarily update .env.local with production credentials
npm run db:setup-permissions

# Option 2: Run SQL directly via psql or database client
```

SQL to run:
```sql
CREATE TABLE IF NOT EXISTS user_permission (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3, 4)),
  school_codes TEXT[],
  regions TEXT[],
  read_only BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_permission_email
ON user_permission (LOWER(email));

-- Add production admin users (update emails as needed)
INSERT INTO user_permission (email, level) VALUES
  ('admin@avantifellows.org', 4)
ON CONFLICT (email) DO NOTHING;
```

### Step 4: Update Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Open your OAuth 2.0 Client
2. Add to **Authorized JavaScript origins**:
   - `https://lms.avantifellows.org` (production)
   - `https://staging-lms.avantifellows.org` (staging)
3. Add to **Authorized redirect URIs**:
   - `https://lms.avantifellows.org/api/auth/callback/google`
   - `https://staging-lms.avantifellows.org/api/auth/callback/google`

### Step 5: Configure Custom Domains (Optional)

In each Vercel project:
1. Go to **Settings > Domains**
2. Add custom domain
3. Configure DNS as instructed by Vercel

---

## Checklist

### Prerequisites
- [x] Get production database credentials
- [x] Get production DB service URL
- [x] Get production DB service token
- [x] Decide on Vercel setup (Option A: two projects)
- [x] Decide on domain names (`lms.avantifellows.org`)

### Phase 1: Create Production Project
- [x] Create `af-lms-production` Vercel project
- [x] Link repo to production project
- [x] Set all environment variables
- [x] Create local `.env.production` file (gitignored)

### Phase 2: Deploy & Domain
- [x] Deploy to production (`vercel --prod`)
- [x] Add custom domain `lms.avantifellows.org`
- [x] Configure DNS (A record to `76.76.21.21`)

### Phase 3: External Services
- [x] Update Google OAuth authorized domains
- [ ] Create `user_permission` table in production DB (if not exists)
- [ ] Add production admin users

### Phase 4: Verify & Finalize
- [ ] Test production deployment end-to-end
- [x] Re-link local repo to staging project
- [ ] Document any issues encountered

---

## Scripts

### Setup permissions table
```bash
npm run db:setup-permissions
```

### Test database connection
```bash
npm run db:test-connection
```

---

## Troubleshooting

### "Invalid credentials" error
- Verify DATABASE_PASSWORD is correct
- Check if your IP is whitelisted in AWS RDS security group

### "NEXTAUTH_URL mismatch" error
- Ensure NEXTAUTH_URL matches the actual deployment URL exactly
- Include https:// and no trailing slash

### Google OAuth redirect error
- Verify redirect URI is added in Google Cloud Console
- URI must match exactly: `https://your-domain.com/api/auth/callback/google`
