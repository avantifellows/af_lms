# TODO: Setting Up Staging and Production Environments

## What I Need From You

### 1. Production Database Credentials
- `DATABASE_HOST` - Production DB host
- `DATABASE_PORT` - Production DB port
- `DATABASE_USER` - Production DB user
- `DATABASE_PASSWORD` - Production DB password
- `DATABASE_NAME` - Production DB name

### 2. Production DB Service
- `DB_SERVICE_URL` - Production DB service URL (e.g., `https://db.avantifellows.org/api`)
- `DB_SERVICE_TOKEN` - Production DB service token

### 3. Vercel Project Setup
- Do you want **two separate Vercel projects** (recommended) or **one project with preview/production branches**?
- Production domain (e.g., `lms.avantifellows.org`)
- Staging domain (e.g., `staging-lms.avantifellows.org` or keep current)

### 4. Google OAuth
- Do you need separate Google OAuth credentials for production, or can you add the production domain to the existing OAuth app's authorized domains?

---

## Implementation Steps

### Option A: Two Separate Vercel Projects (Recommended)

1. **Create new Vercel project for production**
   - Link to same GitHub repo
   - Set environment variables for production DB

2. **Configure branches**
   - Production project deploys from `main` branch
   - Staging project deploys from `staging` branch (or `main` with different env vars)

3. **Set environment variables in Vercel dashboard**
   - Each project has its own env vars

### Option B: Single Vercel Project with Environment-based Config

1. **Use Vercel's environment system**
   - "Production" environment → production DB
   - "Preview" environment → staging DB

2. **Set different env vars per environment in Vercel dashboard**

---

## Environment Variables to Configure

### Staging (Current)
```env
DATABASE_HOST=staging-af-db.ct2k2vwmh0ce.ap-south-1.rds.amazonaws.com
DATABASE_PORT=1357
DATABASE_USER=postgres
DATABASE_PASSWORD=***
DATABASE_NAME=staging_af_db
DB_SERVICE_URL=https://staging-db.avantifellows.org/api
DB_SERVICE_TOKEN=***
NEXTAUTH_URL=https://staging-lms.avantifellows.org  # Update this
```

### Production (Need from you)
```env
DATABASE_HOST=???
DATABASE_PORT=???
DATABASE_USER=???
DATABASE_PASSWORD=???
DATABASE_NAME=???
DB_SERVICE_URL=???
DB_SERVICE_TOKEN=???
NEXTAUTH_URL=https://lms.avantifellows.org  # Or your production domain
```

---

## Permissions Table

The `user_permission` table needs to be created in **both** databases:

### For Staging
Already done - table exists with test users.

### For Production
Run the setup script against production DB:
```bash
# Update .env.local with production credentials temporarily, then:
npm run db:setup-permissions
```

Or manually create the table and add production admin users:
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

-- Add production admin users
INSERT INTO user_permission (email, level) VALUES
  ('admin1@avantifellows.org', 4),
  ('admin2@avantifellows.org', 4);
```

---

## References

- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [Vercel Environments (Production/Preview/Development)](https://vercel.com/docs/deployments/environments)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)

---

## Checklist

- [ ] Get production database credentials
- [ ] Get production DB service URL and token
- [ ] Decide on Vercel setup (one project vs two)
- [ ] Create/configure Vercel project(s)
- [ ] Set environment variables in Vercel
- [ ] Create `user_permission` table in production DB
- [ ] Add production admin users
- [ ] Update Google OAuth authorized domains (if needed)
- [ ] Test staging deployment
- [ ] Test production deployment
