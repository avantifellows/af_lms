# Student Permission System Proposal

This document explains the proposed permission system for **students** accessing Avanti Fellows products. This is separate from the [staff permission system](./PERMISSION_SYSTEM_PROPOSAL.md) which controls who can view/manage student data.

---

## Why Separate from Staff Permissions?

| Aspect | Staff Permissions | Student Permissions |
|--------|------------------|---------------------|
| **Question answered** | "Which students can I see?" | "What can I do in the platform?" |
| **Scale** | ~100 staff | ~100,000+ students |
| **Identity** | Email (Google OAuth) | Phone, passcode, or email |
| **Management** | Admin-assigned | Often automatic (enrollment-based) |
| **Granularity** | By product/program/school | By feature/batch/time |

---

## What Students Need Permissions For

### Current Products and Student Actions

| Product | What Students Do | Permission Questions |
|---------|-----------------|---------------------|
| **Quiz Engine** | Take tests, view results | Can retake? Can see answers? When does access expire? |
| **Gurukul** | Watch videos, track progress | Which content is unlocked? Can download? |
| **Reports** | View performance analytics | Can see peer comparison? Can see detailed breakdown? |

### Example Permission Scenarios

| Student | Situation | Permission Needed |
|---------|-----------|-------------------|
| Priya | Enrolled in STP Test Series | Can take all tests in the series until March 2025 |
| Rahul | Missed a test | Teacher grants one-time retake permission |
| Anita | Premium batch | Can view detailed answer explanations |
| Vikram | Trial user | Can only access 3 free tests |
| Deepa | Test completed | Can view answers only after deadline passes |

---

## Proposed Permission Model

### Core Principle: Enrollment-Based Defaults + Overrides

Most permissions should be **automatic** based on enrollment:
- Enrolled in batch → Can take batch's quizzes
- Enrolled in program → Can access program's content
- Test deadline passed → Can view answers

Explicit permissions are only needed for **exceptions**:
- Granting a retake
- Extending access period
- Restricting a specific feature

### Permission Levels

| Level | Name | How it works |
|-------|------|--------------|
| **Platform** | Global defaults | All students can do X by default |
| **Product** | Product-wide rules | Quiz Engine students can view leaderboard |
| **Program** | Program-specific | STP Punjab students get answer keys |
| **Batch** | Batch-specific | This batch can retake tests |
| **Individual** | Per-student override | Priya can retake Test #5 |

---

## Database Schema

### Option A: Simple Feature Flags (Recommended to Start)

For MVP, store permissions as columns on existing tables:

```sql
-- Add to batch or program table
ALTER TABLE batch ADD COLUMN permissions JSONB DEFAULT '{}';

-- Example permissions JSON:
-- {
--   "can_view_leaderboard": true,
--   "can_view_answers_after_deadline": true,
--   "can_retake_quiz": false,
--   "max_retakes": 0,
--   "access_expires_at": "2025-03-31"
-- }
```

For individual overrides:

```sql
CREATE TABLE student_permission_override (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "user"(id) NOT NULL,

  -- What this override applies to
  scope_type VARCHAR(20) NOT NULL,  -- 'quiz', 'batch', 'program'
  scope_id INTEGER NOT NULL,         -- ID of the quiz/batch/program

  -- The override
  permission_key VARCHAR(50) NOT NULL,  -- 'can_retake', 'access_until'
  permission_value JSONB NOT NULL,       -- true, false, "2025-03-31", 3

  -- Metadata
  granted_by INTEGER REFERENCES "user"(id),  -- Which staff granted this
  reason TEXT,                                -- "Missed due to illness"
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,                       -- Override can auto-expire

  UNIQUE(user_id, scope_type, scope_id, permission_key)
);
```

### Option B: Full Permission Table (If Needed Later)

If permissions become complex, a dedicated table:

```sql
CREATE TABLE student_permission (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "user"(id) NOT NULL,

  -- Scope (what does this permission apply to?)
  scope_type VARCHAR(20) NOT NULL,  -- 'platform', 'product', 'program', 'batch', 'quiz'
  scope_id INTEGER,                  -- NULL for platform-wide

  -- Time bounds
  valid_from TIMESTAMP DEFAULT NOW(),
  valid_until TIMESTAMP,

  -- Feature permissions (JSONB for flexibility)
  permissions JSONB NOT NULL,
  -- Example: {
  --   "can_take_quiz": true,
  --   "can_view_answers": "after_deadline",
  --   "can_view_leaderboard": true,
  --   "can_retake": false,
  --   "retakes_remaining": 0,
  --   "can_download_content": false
  -- }

  -- Audit
  granted_by INTEGER REFERENCES "user"(id),
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_student_permission_user ON student_permission(user_id);
CREATE INDEX idx_student_permission_scope ON student_permission(scope_type, scope_id);
```

---

## Permission Resolution Logic

When checking if a student can do something, check in order (first match wins):

```
1. Individual override for this specific item
   ↓ if not found
2. Batch-level permission
   ↓ if not found
3. Program-level permission
   ↓ if not found
4. Product-level default
   ↓ if not found
5. Platform-wide default
```

### Example: "Can Rahul retake Quiz #123?"

```python
def can_retake_quiz(user_id, quiz_id):
    # 1. Check individual override
    override = get_override(user_id, 'quiz', quiz_id, 'can_retake')
    if override is not None:
        return override

    # 2. Check batch permission
    batch = get_quiz_batch(quiz_id)
    if batch.permissions.get('can_retake') is not None:
        return batch.permissions['can_retake']

    # 3. Check program permission
    program = get_batch_program(batch.id)
    if program.permissions.get('can_retake') is not None:
        return program.permissions['can_retake']

    # 4. Product default
    return PRODUCT_DEFAULTS['quiz_engine']['can_retake']  # False
```

---

## Common Permission Types

### Quiz Engine Permissions

| Permission | Type | Default | Description |
|------------|------|---------|-------------|
| `can_take_quiz` | boolean | true | Can attempt the quiz |
| `can_view_answers` | enum | `after_deadline` | When answers are visible: `never`, `after_submission`, `after_deadline` |
| `can_retake` | boolean | false | Can retake after submission |
| `max_retakes` | integer | 0 | How many retakes allowed |
| `retakes_remaining` | integer | 0 | Retakes left (decrements) |
| `time_extension_minutes` | integer | 0 | Extra time for this student |
| `access_until` | timestamp | null | When access expires |

### Gurukul Permissions

| Permission | Type | Default | Description |
|------------|------|---------|-------------|
| `can_access_content` | boolean | true | Can view videos/materials |
| `can_download` | boolean | false | Can download for offline |
| `content_unlocked_until` | integer | null | Chapter number unlocked to |
| `is_premium` | boolean | false | Has premium features |

### Report Permissions

| Permission | Type | Default | Description |
|------------|------|---------|-------------|
| `can_view_own_report` | boolean | true | Can see their own performance |
| `can_view_leaderboard` | boolean | true | Can see peer rankings |
| `can_view_detailed_breakdown` | boolean | false | Can see question-level analysis |
| `can_export_report` | boolean | false | Can download PDF report |

---

## Implementation Recommendation

### Phase 1: Start Simple (Recommended)

1. **Add permissions JSONB to batch table** - most permissions are batch-level
2. **Create student_permission_override table** - for individual exceptions
3. **Define sensible defaults in code** - don't store unless different from default

This handles 90% of cases with minimal schema changes.

### Phase 2: Expand if Needed

1. Add program-level permissions if batches in same program need consistency
2. Add product-level defaults table if managing many products
3. Add permission history/audit table if compliance requires it

---

## Integration with Existing System

### Using the Group System

Your existing `group` + `group_user` system already tracks enrollments:
- Student in batch → `group_user` row where group.type = 'batch'
- Student in school → `group_user` row where group.type = 'school'

Permissions layer on top:
```
group_user (enrollment) + batch.permissions (defaults) + student_permission_override (exceptions)
```

### Authentication Integration

| Auth Method | How to Link Permissions |
|-------------|------------------------|
| Google OAuth | Match by email in user table |
| Passcode | Passcode → school → user_id |
| Phone/OTP | Phone → user_id |

---

## Questions for Discussion

1. **Who grants overrides?** Any staff with access to the student? Only batch admins?

2. **Audit requirements?** Do we need full history of permission changes?

3. **Bulk operations?** "Grant retake to all students who scored < 30%"

4. **Time zones?** For `access_until` deadlines, which timezone?

5. **Inheritance?** If a student is in multiple batches with different permissions, which wins?

---

## Comparison: Staff vs Student Permissions

| Aspect | Staff (`user_permission`) | Student (`student_permission_override`) |
|--------|--------------------------|----------------------------------------|
| **Key identifier** | email | user_id |
| **Scope dimensions** | products, programs, schools, regions | products, programs, batches, quizzes |
| **Permission types** | Access levels (1-4), read_only | Feature flags, counts, timestamps |
| **Default behavior** | No access unless granted | Access via enrollment, restrict via override |
| **Management UI** | Admin dashboard | Teacher/coordinator dashboard |

---

## Next Steps

1. Review this proposal with product team
2. Decide on Phase 1 scope (which permissions to implement first)
3. Choose Option A (simple) or Option B (full table)
4. Implement for Quiz Engine first (highest impact)
5. Extend to Gurukul and Reports as needed
