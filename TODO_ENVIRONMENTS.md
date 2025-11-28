# Setting Up Staging and Production Environments

## Status

| Item | Status |
|------|--------|
| Production database credentials | Done |
| Production DB service URL | Done |
| Production DB service token | **Pending** (need from admin) |
| Vercel setup decision | Option A (two projects) |
| Domain names | **Pending** (decide later) |

---

## Environment Files Created

```
.env.example              # Generic template for local development
.env.staging.example      # Reference for staging Vercel project
.env.production.example   # Reference for production Vercel project
```

---

## Configuration Values

### Staging
| Variable | Value |
|----------|-------|
| DATABASE_HOST | staging-af-db.ct2k2vwmh0ce.ap-south-1.rds.amazonaws.com |
| DATABASE_PORT | 1357 |
| DATABASE_USER | postgres |
| DATABASE_NAME | staging_af_db |
| DB_SERVICE_URL | https://staging-db.avantifellows.org/api |
| NEXTAUTH_URL | https://staging-lms.avantifellows.org (TBD) |

### Production
| Variable | Value |
|----------|-------|
| DATABASE_HOST | af-database.ct2k2vwmh0ce.ap-south-1.rds.amazonaws.com |
| DATABASE_PORT | 1357 |
| DATABASE_USER | postgres |
| DATABASE_NAME | prod_af_db |
| DB_SERVICE_URL | https://db.avantifellows.org/api |
| NEXTAUTH_URL | https://lms.avantifellows.org (TBD) |

---

## Setup Steps

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

- [x] Get production database credentials
- [x] Get production DB service URL
- [ ] Get production DB service token (waiting on admin)
- [x] Decide on Vercel setup (Option A: two projects)
- [ ] Decide on domain names
- [ ] Create staging Vercel project
- [ ] Create production Vercel project
- [ ] Set environment variables in both projects
- [ ] Create `user_permission` table in production DB
- [ ] Add production admin users
- [ ] Update Google OAuth authorized domains
- [ ] Test staging deployment
- [ ] Test production deployment

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
