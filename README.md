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

- Node.js >= 20.9.0 (use `nvm use` to auto-select from `.nvmrc`)
- Access to the PostgreSQL database
- Google OAuth credentials (for admin auth)
- DB Service API access (for write operations)

## Setup

1. **Clone and install dependencies**:
   ```bash
   git clone https://github.com/avantifellows/af_lms.git
   cd af_lms
   nvm use
   npm install
   ```

2. **Configure environment variables**:

   Create `.env.local` with:
   ```env
   # Database (direct read access)
   DATABASE_HOST=your-db-host
   DATABASE_PORT=5432
   DATABASE_USER=your-db-user
   DATABASE_PASSWORD=your-db-password
   DATABASE_NAME=your-db-name

   # NextAuth
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=your-nextauth-secret

   # Google OAuth
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret

   # DB Service (for write operations)
   DB_SERVICE_URL=https://staging-db.avantifellows.org/api
   DB_SERVICE_TOKEN=your-db-service-token
   ```

3. **Set up permissions table** (first time only):
   ```bash
   npm run db:setup-permissions
   ```
   This creates the `user_permission` table and seeds initial admin users. The script is idempotent - safe to run multiple times.

4. **Run development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000)

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

The app is configured for Vercel deployment. See `vercel.json` for configuration.

Environment variables must be set in Vercel dashboard.
