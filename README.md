# JNV Student Enrollment CRUD UI

Admin interface for managing JNV (Jawahar Navodaya Vidyalaya) student enrollments for Avanti Fellows.

## Features

- **Student Management**: View and edit student details (name, ID, APAAR ID, grade, category, stream, etc.)
- **School Dashboard**: Browse schools with search and filtering
- **Student Search**: Search students across accessible schools by name, ID, or phone
- **Grade Filtering**: Filter students by grade within a school
- **User Permissions**: Role-based access control with 4 levels:
  - Level 4 (Admin): Full access + user management
  - Level 3 (All Schools): Access to all JNV schools
  - Level 2 (Region): Access to schools in specific regions
  - Level 1 (School): Access to specific schools only
- **Read-only Mode**: Optional view-only access for any permission level

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Auth**: NextAuth.js v4 (Google OAuth + passcode auth)
- **Database**: PostgreSQL (direct connection for reads)
- **Styling**: Tailwind CSS v4
- **External API**: DB Service for student updates

## Prerequisites

- macOS, Linux, or Windows with WSL
- Access to the PostgreSQL database credentials
- Google OAuth credentials (for admin auth)
- DB Service API access (for write operations)

---

## Installation Guide (Step-by-Step)

### Step 1: Install nvm (Node Version Manager)

nvm lets you install and switch between different Node.js versions.

**On macOS/Linux**, open Terminal and run:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

After it finishes, **close and reopen your terminal**, then verify it worked:
```bash
nvm --version
```
You should see a version number like `0.40.1`.

**Troubleshooting**: If `nvm: command not found`, run this and try again:
```bash
source ~/.bashrc
```
Or if you use zsh (default on newer Macs):
```bash
source ~/.zshrc
```

### Step 2: Install Node.js 22

```bash
nvm install 22
```

Verify it installed correctly:
```bash
node --version
```
You should see `v22.x.x` (e.g., `v22.21.1`).

### Step 3: Clone the Repository

```bash
git clone https://github.com/avantifellows/af_lms.git
cd af_lms
```

### Step 4: Use the Correct Node Version

The project includes a `.nvmrc` file that specifies the Node version. Run:
```bash
nvm use
```
You should see: `Now using node v22.x.x`

### Step 5: Install Dependencies

```bash
npm install
```

This will download all required packages. Wait for it to complete.

### Step 6: Set Up Environment Variables

Copy the example file:
```bash
cp .env.example .env.local
```

Open `.env.local` in a text editor and fill in the values. Ask your team lead for the actual credentials:

```env
# Database (get these from your team lead)
DATABASE_HOST=your-db-host
DATABASE_PORT=1357
DATABASE_USER=postgres
DATABASE_PASSWORD=your-db-password
DATABASE_NAME=your-db-name

# DB Service (get these from your team lead)
DB_SERVICE_URL=https://staging-db.avantifellows.org/api
DB_SERVICE_TOKEN=your-db-service-token

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate-a-random-string

# Google OAuth (get these from your team lead)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

To generate `NEXTAUTH_SECRET`, run:
```bash
openssl rand -base64 32
```
Copy the output and paste it as the value.

### Step 7: Set Up the Database (First Time Only)

```bash
npm run db:setup-permissions
```

This creates the permissions table. It's safe to run multiple times.

### Step 8: Start the Development Server

```bash
npm run dev
```

Open your browser and go to: [http://localhost:3000](http://localhost:3000)

---

## Common Issues

### "nvm: command not found"
Close and reopen your terminal, or run `source ~/.zshrc` (Mac) or `source ~/.bashrc` (Linux).

### "Node version X is not installed"
Run `nvm install 22` then `nvm use`.

### "Cannot connect to database"
Check that your `.env.local` has the correct database credentials. Make sure your IP is whitelisted if connecting to a remote database.

### Build fails with Node version error
Make sure you ran `nvm use` before `npm run dev` or `npm run build`.

---

## Daily Development Workflow

Each time you open a new terminal to work on this project:

```bash
cd af_lms        # Go to the project folder
nvm use          # Switch to the correct Node version
npm run dev      # Start the development server
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:setup-permissions` | Create/update permissions table |

## Architecture Notes

### Database Access Pattern

This app uses a **hybrid approach**:
- **Reads**: Direct PostgreSQL connection (for performance)
- **Writes**: Via DB Service API (maintains data consistency)

This is intentional technical debt for rapid development. The DB Service is Avanti Fellows' canonical data layer.

### Permission System

Permissions are stored in `user_permission` table:
- `email`: User's email (unique)
- `level`: Access level (1-4)
- `school_codes`: Array of school codes (for level 1)
- `regions`: Array of region names (for level 2)
- `read_only`: Boolean for view-only access

### Key Files

```
src/
├── app/
│   ├── dashboard/          # School listing + student search
│   ├── school/[udise]/     # Student table for a school
│   ├── admin/              # Admin pages
│   │   └── users/          # User management
│   └── api/
│       ├── admin/          # Admin API routes
│       ├── student/        # Student update API
│       └── students/search # Student search API
├── components/
│   ├── StudentTable.tsx    # Student list with grade filter
│   ├── StudentSearch.tsx   # Global student search
│   └── EditStudentModal.tsx
├── lib/
│   ├── auth.ts             # NextAuth config
│   ├── db.ts               # PostgreSQL connection
│   └── permissions.ts      # Permission helpers
└── scripts/
    └── setup-permissions.ts
```

## Adding New Admin Users

1. Go to `/admin/users` (requires admin access)
2. Click "Add User"
3. Enter email and select permission level
4. For Region/School access, select the specific regions or schools
5. Optionally enable "Read-only access"

Or manually via database:
```sql
INSERT INTO user_permission (email, level, school_codes, regions, read_only)
VALUES ('user@example.com', 3, NULL, NULL, false);
```

## Deployment

The app uses two separate Vercel projects:

| Environment | Vercel Project | URL | Branch |
|-------------|----------------|-----|--------|
| **Staging** | `af-lms` | https://af-lms.vercel.app | `main` |
| **Production** | `af-lms-production` | https://lms.avantifellows.org | `deploy-production` |

### Quick Deploy

```bash
# Deploy to staging
./scripts/deploy.sh staging

# Deploy to production
./scripts/deploy.sh production
```

### Manual Deploy

If you prefer manual steps:

```bash
# Staging
vercel link --project af-lms --yes
vercel --prod

# Production
vercel link --project af-lms-production --yes
vercel --prod
```

### Environment Variables

Each Vercel project has its own environment variables. To view/edit:

```bash
# Link to the project first
vercel link --project af-lms-production --yes

# List env vars
vercel env ls production

# Pull env vars locally (for debugging)
vercel env pull .env.local

# Add a new env var
echo -n "value" | vercel env add VAR_NAME production

# Remove an env var
vercel env rm VAR_NAME production --yes
```

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `DATABASE_HOST` | PostgreSQL host |
| `DATABASE_PORT` | PostgreSQL port |
| `DATABASE_USER` | PostgreSQL user |
| `DATABASE_PASSWORD` | PostgreSQL password |
| `DATABASE_NAME` | PostgreSQL database name |
| `DB_SERVICE_URL` | DB Service API URL |
| `DB_SERVICE_TOKEN` | DB Service API token |
| `NEXTAUTH_URL` | App URL (e.g., `https://lms.avantifellows.org`) |
| `NEXTAUTH_SECRET` | Random secret for NextAuth |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

**Important:** When adding env vars, use `echo -n` to avoid trailing newlines which can cause auth errors.

### Google OAuth Setup

The Google OAuth client must have authorized redirect URIs for both environments:

```
https://af-lms.vercel.app/api/auth/callback/google
https://lms.avantifellows.org/api/auth/callback/google
```

Configure these in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
