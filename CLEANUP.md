# Cleanup & Technical Debt

This document tracks technical improvements to address after initial testing is complete.

**Load assumptions**: 20 concurrent users, 1000 student updates/day

---

## Critical (Fix Before Production)

### 1. Database Connection Pool Not Configured
**File**: `src/lib/db.ts:1-15`

**Problem**: Using default pool settings. 20 concurrent users making 3 queries each = 60 connections, but default max is 10.

**Fix**:
```typescript
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || "5432"),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
  // Add these:
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

---

### 2. Hardcoded Passcodes in Source Code
**File**: `src/lib/permissions.ts:25-31`

**Problem**: Passcodes visible in git history, can't rotate without deploy.

**Current**:
```typescript
const SCHOOL_PASSCODES: SchoolPasscode[] = [
  { schoolCode: "70705", passcode: "70705123" },
  { schoolCode: "14042", passcode: "14042456" },
];
```

**Fix**: Move to database table:
```sql
CREATE TABLE school_passcode (
  id SERIAL PRIMARY KEY,
  school_code VARCHAR(10) NOT NULL,
  passcode_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Then query with bcrypt comparison instead of plaintext lookup.

---

### 3. SSL Verification Disabled
**File**: `src/lib/db.ts:9`

**Problem**: `rejectUnauthorized: false` allows MITM attacks on database connection.

**Fix**:
```typescript
ssl: process.env.NODE_ENV === 'production' 
  ? { rejectUnauthorized: true }
  : { rejectUnauthorized: false }
```

---

### 4. No Timeout on External Service Calls
**File**: `src/app/api/student/route.ts:31-42`

**Problem**: Calls to DB service can hang indefinitely.

**Fix**:
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch(`${DB_SERVICE_URL}/student`, {
    signal: controller.signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  // ... handle response
} catch (error) {
  if (error.name === 'AbortError') {
    return NextResponse.json({ error: "Request timeout" }, { status: 504 });
  }
  throw error;
} finally {
  clearTimeout(timeout);
}
```

Apply same pattern to `src/app/api/student/dropout/route.ts`.

---

## High Priority

### 5. Inefficient LATERAL Subquery in Student Query
**File**: `src/app/school/[udise]/page.tsx:40-75`

**Problem**: LATERAL subquery executes once per student row. Slow for schools with 100+ students.

**Current** (simplified):
```sql
LEFT JOIN LATERAL (
  SELECT p.name FROM group_user gu_batch
  JOIN "group" g_batch ON ...
  JOIN batch b ON ...
  JOIN program p ON ...
  WHERE gu_batch.user_id = u.id
  LIMIT 1
) p ON true
```

**Fix**: Use window function or CTE:
```sql
WITH student_programs AS (
  SELECT DISTINCT ON (gu.user_id)
    gu.user_id,
    p.name as program_name
  FROM group_user gu
  JOIN "group" g ON gu.group_id = g.id AND g.type = 'batch'
  JOIN batch b ON g.child_id = b.id
  JOIN program p ON b.program_id = p.id
  ORDER BY gu.user_id, p.id
)
SELECT ...
FROM group_user gu
LEFT JOIN student_programs sp ON sp.user_id = gu.user_id
...
```

---

### 6. Query Duplication in Dashboard
**File**: `src/app/dashboard/page.tsx:12-65`

**Problem**: 4 nearly identical query variants for `getSchools()`.

**Fix**: Create query builder:
```typescript
async function getSchools(
  codes: string[] | "all",
  search?: string
): Promise<School[]> {
  const conditions = ["af_school_category = 'JNV'"];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (codes !== "all" && codes.length > 0) {
    conditions.push(`code = ANY($${paramIndex++})`);
    params.push(codes);
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(`(name ILIKE $${paramIndex} OR code ILIKE $${paramIndex} OR district ILIKE $${paramIndex})`);
    params.push(pattern);
    paramIndex++;
  }

  return query<School>(
    `SELECT id, code, name, udise_code, district, state, region
     FROM school
     WHERE ${conditions.join(" AND ")}
     ORDER BY name
     LIMIT 100`,
    params
  );
}
```

---

### 7. Query Duplication in Student Search
**File**: `src/app/api/students/search/route.ts:35-90`

**Problem**: Two 95% identical queries, only WHERE clause differs.

**Fix**: Same pattern as #6 - use dynamic query builder.

---

### 8. Silent Search Failures
**File**: `src/components/StudentSearch.tsx:28-38`

**Problem**: Network errors only logged to console, user sees empty results.

**Current**:
```typescript
} catch (error) {
  console.error("Search error:", error);
}
```

**Fix**:
```typescript
} catch (error) {
  console.error("Search error:", error);
  setError("Search failed. Please try again.");
}
```

Add error state and display in component.

---

### 9. No Rate Limiting on Mutations
**Files**: 
- `src/app/api/student/route.ts`
- `src/app/api/student/dropout/route.ts`
- `src/app/api/admin/users/route.ts`

**Problem**: No protection against abuse. One user could spam 1000 updates in seconds.

**Fix**: Add rate limiting with Upstash or similar:
```typescript
// lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const updateLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, "1 h"),
});

// In API route:
const { success } = await updateLimiter.limit(session.user.email);
if (!success) {
  return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
}
```

---

### 10. Passcode Users Bypass Read-Only Checks
**File**: `src/app/school/[udise]/page.tsx:97-100`

**Problem**: Passcode users always have edit rights, ignoring `read_only` flag.

**Current**:
```typescript
const canEdit = isPasscodeUser
  ? true  // Always true!
  : await canEditStudents(session.user?.email || "");
```

**Fix**: Check passcode-specific permissions or remove auto-edit for passcode users.

---

## Medium Priority

### 11. Duplicate Admin Auth Checks
**Files**:
- `src/app/api/admin/users/route.ts:8-23`
- `src/app/api/admin/users/[id]/route.ts:8-23`
- `src/app/api/admin/schools/route.ts:8-23`

**Problem**: Same 8 lines repeated in 4+ files.

**Fix**: Create middleware wrapper:
```typescript
// lib/api-auth.ts
export function withAdminAuth(
  handler: (req: NextRequest, ctx: any, session: Session) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: any) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.email))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, ctx, session);
  };
}

// Usage:
export const POST = withAdminAuth(async (req, ctx, session) => {
  // Handler logic
});
```

---

### 12. Inconsistent API Response Format
**Files**: Multiple API routes

**Problem**: Some return `{ id, success }`, some return `{ success }`, some return bare arrays.

**Fix**: Standardize:
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Success: { success: true, data: [...] }
// Error: { success: false, error: "message" }
```

---

### 13. Missing Session Timeout
**File**: `src/lib/auth.ts:31-33`

**Problem**: Default 30-day session is too long for sensitive student data.

**Fix**:
```typescript
session: {
  strategy: "jwt",
  maxAge: 8 * 60 * 60, // 8 hours
}
```

---

### 14. Type Safety Gap with Session
**File**: `src/lib/auth.ts:42-45`

**Problem**: Using `(session as any)` breaks TypeScript.

**Fix**: Extend types properly:
```typescript
// types/next-auth.d.ts
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    schoolCode?: string;
    isPasscodeUser?: boolean;
  }
}
```

---

### 15. Missing Input Validation
**File**: `src/components/EditStudentModal.tsx:20-27`

**Problem**: No validation on phone format, student ID, category values.

**Fix**: Add validation before submit:
```typescript
const validateForm = () => {
  if (formData.phone && !/^\d{10}$/.test(formData.phone)) {
    return "Phone must be 10 digits";
  }
  const validCategories = ["Gen", "OBC", "SC", "ST", "Gen-EWS"];
  if (formData.category && !validCategories.includes(formData.category)) {
    return "Invalid category";
  }
  return null;
};
```

---

### 16. No Upper Bound on Search Query
**File**: `src/app/api/students/search/route.ts:25`

**Problem**: 10,000 character search query possible, could slow down ILIKE.

**Fix**:
```typescript
if (searchQuery.length < 2 || searchQuery.length > 100) {
  return NextResponse.json([]);
}
```

---

## Low Priority

### 17. Duplicate CSS Classes
**Files**: `src/components/EditStudentModal.tsx`, `src/app/admin/users/AddUserModal.tsx`

**Problem**: Same input/label classes defined in multiple files.

**Fix**: Extract to constants:
```typescript
// lib/styles.ts
export const inputClassName = "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
export const labelClassName = "block text-sm font-medium text-gray-700";
```

---

### 18. No Pagination on School List
**File**: `src/app/dashboard/page.tsx:48`

**Problem**: `LIMIT 100` loads potentially unnecessary data.

**Fix**: Add pagination with page/offset params.

---

### 19. No API Documentation
**Files**: All API routes

**Problem**: No OpenAPI/Swagger specs for external consumers.

**Fix**: Add JSDoc swagger comments or generate from types.

---

### 20. Limited Logging
**Files**: All

**Problem**: Only `console.error` for debugging, no structured logging.

**Fix**: Add Winston or Pino for production logging with log levels.

---

## Summary

| Priority | Count | Estimated Time |
|----------|-------|----------------|
| Critical | 4 | 2-3 hours |
| High | 6 | 4-5 hours |
| Medium | 6 | 3-4 hours |
| Low | 4 | 2-3 hours |
| **Total** | **20** | **11-15 hours** |

---

## Checklist

### Critical
- [ ] Configure database connection pool
- [ ] Move passcodes to database
- [ ] Fix SSL verification for production
- [ ] Add timeout to external service calls

### High
- [ ] Optimize LATERAL subquery in student query
- [ ] Consolidate dashboard queries
- [ ] Consolidate search queries
- [ ] Add error handling to StudentSearch
- [ ] Add rate limiting
- [ ] Fix passcode user edit permissions

### Medium
- [ ] Extract admin auth middleware
- [ ] Standardize API response format
- [ ] Add session timeout
- [ ] Fix session type safety
- [ ] Add input validation
- [ ] Add search query length limit

### Low
- [ ] Extract CSS classes to constants
- [ ] Add pagination to school list
- [ ] Add API documentation
- [ ] Add structured logging
