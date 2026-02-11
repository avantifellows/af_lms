# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Student Enrollment CRUD UI for Avanti Fellows - a Next.js 16 application that allows school administrators to view and manage student enrollments. Features dual authentication (Google OAuth + school passcodes) with permission-based access control.

## Development Commands

```bash
npm run dev      # Start development server at localhost:3000
npm run build    # Production build
npm run lint     # Run ESLint
npm run start    # Start production server
```

## Architecture

### Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Auth**: NextAuth.js v4 with Google OAuth + custom passcode provider
- **Database**: PostgreSQL via `pg` pool
- **Styling**: Tailwind CSS v4

### Directory Structure
```
src/
├── app/                    # Next.js App Router pages
│   ├── api/auth/           # NextAuth API route
│   ├── dashboard/          # School list (admin view)
│   └── school/[udise]/     # Student list per school
├── components/
│   └── Providers.tsx       # SessionProvider wrapper
└── lib/
    ├── auth.ts             # NextAuth configuration
    ├── db.ts               # PostgreSQL connection pool
    └── permissions.ts      # Access control (hardcoded)
```

### Authentication Flow
1. **Google OAuth**: Users with `@avantifellows.org` or whitelisted emails get role-based access
2. **Passcode Auth**: 8-digit codes grant single-school access (format: `{schoolCode}XXX`)

### Permission Levels
Defined in `src/lib/permissions.ts`:
- **Level 3**: All schools access (admin)
- **Level 2**: Region-based access (not fully implemented)
- **Level 1**: Specific school codes only

### Database Schema (External PostgreSQL)
Tables queried:
- `school`: id, code, udise_code, name, district, state, region
- `user`: id, first_name, last_name, phone, email, gender
- `student`: user_id, student_id, category, stream
- `group`: id, type, child_id
- `group_user`: id, group_id, user_id

### Key Patterns
- Server components for data fetching (`getServerSession` + direct DB queries)
- Client components for interactivity (`"use client"` directive)
- Path alias: `@/*` maps to `./src/*`

## Environment Variables Required

```
DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET, NEXTAUTH_URL
```

## Deployment

Deployed on AWS Amplify. Database SSL is enabled with `rejectUnauthorized: false`.
