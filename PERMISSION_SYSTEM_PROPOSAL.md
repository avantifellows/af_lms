# Permission System Proposal

This document explains the proposed permission system for Avanti Fellows staff to access student data across different products and programs.

---

## How Students Are Organized (Current State)

### The Building Blocks

| Entity | What it is | Example |
|--------|-----------|---------|
| **Student** | An individual learner | Priya Sharma |
| **Batch** | A group of students studying together | "JNV NVS G11 Engineering" (11,138 students) |
| **School** | A physical school | "JNV Kokrajhar" (493 students) |
| **Program** | A collection of batches for a specific initiative | "STP Test Series Punjab" |
| **Product** | A type of program delivery | "TP-Async", "FN-Broadcast", "TP-Phy" |
| **Region** | A geographic grouping of JNV schools | "Hyderabad" (87 schools, 22,726 students) |
| **State** | State-level grouping | "Uttar Pradesh" (77 schools) |

### Real Examples from Our Database

#### Products We Have (All 10)
| Product | Mode | Model | Example Programs |
|---------|------|-------|-----------------|
| TP-Async | Online | Asynchronous | JNV NVS, Gujarat Test Series, Disha Test Series |
| TP-Broadcast | Broadcast | Synchronous | Gujarat Broadcast |
| TP-Phy | Offline | Synchronous | Physical coaching programs |
| TP-Sync | Online | Synchronous | Online live classes |
| FN-Async | Online | Asynchronous | SCERT Foundation, STP Foundation |
| FN-Broadcast | Broadcast | Synchronous | JNV Foundation Enable, JNV Foundation Nagaland |
| FN-Phy | Offline | Synchronous | Maharashtra Foundation, Pune Foundation Bridge |
| Gurukul-Async | Online | Asynchronous | Gurukul - All India |
| TT-Sync | Offline | Synchronous | Teacher training programs |
| No product | - | - | Programs not yet categorized |

#### Programs (Examples)
| Program | State/Scope | Product | What it is |
|---------|-------------|---------|-----------|
| STP Test Series Punjab | Punjab | TP-Async | ~72,000 students across batches |
| JNV NVS | JNV (all India) | TP-Async | ~21,700 students (G11 Engg + Med) |
| JNV Foundation Enable | JNV (all India) | FN-Broadcast | ~14,000 students |
| Gujarat Broadcast | Gujarat | TP-Broadcast | Broadcast classes for Gujarat |
| Girls In Stem JNV | JNV (all India) | FN-Phy | STEM clubs in specific JNV schools |

#### Schools (JNV Examples)
| School | Code | Region | State |
|--------|------|--------|-------|
| JNV Kokrajhar | 39241 | Shillong | Assam |
| JNV Kottayam | 79012 | Hyderabad | Kerala |
| JNV Panchmahal | 14047 | Pune | Gujarat |

#### Batches (Examples)
| Batch | Program | Students |
|-------|---------|----------|
| A11M01 | STP Test Series Punjab | 36,414 |
| A12M01 | STP Test Series Punjab | 35,743 |
| Delhi Test Series Batch | STP Test Series Delhi | 17,070 |
| JNV NVS G11 Engg | JNV NVS | 11,138 |

#### Regions (JNV)
| Region | Schools | Students |
|--------|---------|----------|
| Hyderabad | 87 | 22,726 |
| Shillong | 100 | 21,425 |
| Pune | 75 | 18,650 |
| Bhopal | 113 | 14,508 |
| Lucknow | 90 | 10,733 |

---

## The Problem: Different Access Patterns

Different staff need different types of access:

### Example Scenarios

| Person | Role | What they need access to |
|--------|------|-------------------------|
| Pritam | Tech Admin | Everything (all products, all programs) |
| Ravi | JNV Program Lead | All JNV schools and batches |
| Sunita | Regional Coordinator | All schools in "Bhopal" region |
| Amit | School Coordinator | Only JNV Kokrajhar school |
| Priya | Punjab Program Manager | All batches in "STP Test Series Punjab" |
| Deepa | Read-only Analyst | Can view JNV NVS data but not edit |

---

## Proposed Solution: Flexible Permission Table

### Permission Levels

| Level | Name | What it means |
|-------|------|---------------|
| **Super Admin** | Platform Admin | Access to EVERYTHING across all products |
| **4** | Product Admin | Full access + can manage users within their products |
| **3** | Full Access | See all data within their products |
| **2** | Grouped Access | See data for their regions/states |
| **1** | Specific Access | See only named schools/programs/batches |

### What Can Be Granted Access To

| Scope | Use Case |
|-------|----------|
| **Products** | "Can only see TP-Async programs" |
| **Programs** | "Can only see STP Test Series Punjab" |
| **Schools** | "Can only see JNV Kokrajhar and JNV Kottayam" |
| **Regions** | "Can see all schools in Bhopal region" |

*Note: Batch-level and state-level access can be added later if needed. We're starting simple.*

### Example Permissions

#### Example 1: Super Admin (Pritam)
```
is_super_admin: true
→ Can see and manage everything
```

#### Example 2: JNV Program Lead (Ravi)
```
products: ['TP-Async', 'FN-Broadcast']
level: 4 (Admin)
→ Can see all JNV-related programs
→ Can manage other users for these products
```

#### Example 3: Regional Coordinator (Sunita)
```
products: ['TP-Async']
level: 2 (Grouped)
regions: ['Bhopal']
→ Can see all 113 schools in Bhopal region
→ Can see all students in those schools
```

#### Example 4: School Coordinator (Amit)
```
products: ['TP-Async']
level: 1 (Specific)
school_codes: ['39241']  (JNV Kokrajhar's code)
→ Can only see JNV Kokrajhar
→ Can see all batches within that school
```

#### Example 5: Program Manager (Priya)
```
products: ['TP-Async']
level: 1 (Specific)
program_ids: [ID for STP Test Series Punjab]
→ Can see all batches in STP Test Series Punjab
→ Can see all ~72,000 students
```

#### Example 6: Read-Only Viewer
```
products: ['TP-Async']
level: 1 (Specific)
program_ids: [ID for JNV NVS]
read_only: true
→ Can see the program and its students
→ Cannot edit anything
```

---

## How Access Cascades Down

When you have access to a higher level, you automatically get access to everything below:

```
Product Access
    ↓ grants access to
Program Access
    ↓ grants access to
Batch Access
    ↓ grants access to
Student Access

Region Access
    ↓ grants access to
School Access (all schools in region)
    ↓ grants access to
Student Access (via school)
```

**Example**: If you have access to "STP Test Series Punjab" program, you automatically get access to all batches (A11M01, A12M01, etc.) and all students in those batches.

---

## Database Schema (Technical)

### Recommended: Simple Approach

We already have a `user_permission` table. Instead of rebuilding it, we just add two new columns:

```sql
ALTER TABLE user_permission
ADD COLUMN products TEXT[],
ADD COLUMN program_ids INTEGER[];
```

**Final table structure:**

```sql
CREATE TABLE user_permission (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,

  -- Super Admin (bypasses all checks)
  is_super_admin BOOLEAN DEFAULT false,

  -- Which products can they access? (NULL = all)
  products TEXT[],

  -- Access level
  level INTEGER CHECK (level IN (1, 2, 3, 4)),

  -- School/Region access (existing - for JNV)
  school_codes TEXT[],
  regions TEXT[],

  -- Program access (NEW - for STP and other programs)
  program_ids INTEGER[],

  -- Can they edit or only view?
  read_only BOOLEAN DEFAULT false,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Why This Simple Approach?

| Original Proposal | Simpler Approach |
|-------------------|------------------|
| 8 new columns | 2 new columns |
| Covers hypothetical future needs | Covers actual current needs |
| Complex to implement | Quick to implement |
| May never use some fields | Add more fields later if needed |

**Principle: Build what you need now, extend when you actually need more.**

---

## Questions for Team Discussion

1. **Program → School relationship**: A program can span multiple schools (e.g., CoE schools). Should we add a `program_schools` mapping table in the future?

2. **Multiple permissions per user**: Should one person be able to have different access levels for different products? (e.g., Admin for JNV, but only viewer for STP)

3. **Future needs**: What other access patterns might we need? (e.g., state-level, batch-level, centre-level) We can add these later.

---

## Appendix: Why Our Student Grouping System Works

*This section explains a design decision in our database for those who are curious.*

### The Challenge We Faced

At Avanti, students can belong to many different things at the same time:
- A **school** (JNV Kokrajhar)
- A **batch** (JNV NVS G11 Engineering)
- A **program** (JNV NVS)
- A **grade** (Grade 11)
- A **product** (TP-Async)

And we keep adding new ways to group students as our programs evolve.

### Two Ways to Solve This

**Option A: Separate tables for each grouping**
```
school_students (which students are in which school)
batch_students (which students are in which batch)
program_students (which students are in which program)
grade_students (which students are in which grade)
...and so on
```

**Option B: One flexible "group" system**
```
groups (id, type, child_id)
  → type = "school", child_id = school's ID
  → type = "batch", child_id = batch's ID
  → type = "program", child_id = program's ID

group_users (group_id, user_id)
  → connects any student to any group
```

### We Chose Option B

Why? Because:

| Benefit | What it means |
|---------|---------------|
| **One system for everything** | Enrolling a student in a school or a batch uses the same process |
| **Easy to add new groupings** | When we need "centres" tomorrow, we just add type="centre" |
| **Simpler reporting** | "Show all groups for this student" is one query, not seven |
| **Less code to maintain** | One enrollment system instead of seven separate ones |

### The Tradeoff

This approach is more flexible but slightly harder to understand at first. New team members need to learn how the "group" system works.

But given how often our programs change and evolve, the flexibility is worth it. We're not locked into a rigid structure that needs rebuilding every time we launch a new initiative.

### The Bottom Line

> **There's no perfect database design. You choose your tradeoffs.**

We chose flexibility over simplicity, because Avanti's programs are genuinely complex and constantly evolving. The alternative (separate tables for each grouping type) would have been simpler to understand but harder to extend.

This is working well for us today, and it's why adding new permission types (like program-level access) is straightforward - we just add a `program_ids` column and use the existing group system.

---

## Next Steps

1. Team reviews this proposal
2. Decide on open questions above
3. DB team implements the schema
4. Update crud_ui and other apps to use new permission system
