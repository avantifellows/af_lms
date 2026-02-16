# Database Schema Reference

This document describes the database schema as understood from the CRUD UI implementation. This is for reference when adding new features.

## Core Tables

### `user`
The main user table for all users in the system.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| first_name | string | User's first name |
| last_name | string | User's last name |
| phone | string | Phone number |
| email | string | Email address |
| gender | string | "Male", "Female", "Other" |

### `student`
Extended information for users who are students. Linked to `user` via `user_id`.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| user_id | string | FK to `user.id` |
| student_id | string | Student ID (e.g., "22116002") |
| apaar_id | string | APAAR ID |
| grade_id | string | FK to `grade.id` |
| category | string | "Gen", "OBC", "SC", "ST", "Gen-EWS" |
| stream | string | "engineering", "medical", "pcmb", "foundation", "clat", "ca", "pcb", "pcm" |
| status | string | NULL, "enrolled", "dropout" |
| father_name | string | |
| father_phone | string | |
| mother_name | string | |
| mother_phone | string | |
| ... | | Many other demographic fields |

### `grade`
Grade/class levels.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| number | integer | Grade number (9, 10, 11, 12, 13) |

### `school`
School information.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| code | string | School code (e.g., "14042") |
| udise_code | string | UDISE code |
| name | string | School name |
| district | string | District |
| state | string | State |
| region | string | Region (for JNV: "Bhopal", "Chandigarh", "Hyderabad", "Jaipur", "Lucknow", "Patna", "Pune", "Shillong") |
| af_school_category | string | School category - "JNV" for Jawahar Navodaya Vidyalaya |

### `batch`
Batch information for grouping students.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| program_id | string | FK to `program.id` |
| ... | | Other batch fields |

### `program`
Program information.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| name | string | Program name |
| ... | | Other program fields |

## Group System

The system uses a flexible group mechanism to associate users with schools, batches, grades, etc.

### `group`
Generic group table that can represent different types of associations.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| type | string | Group type: "school", "batch", "grade", "auth_group" |
| child_id | string | FK to the related entity (school.id, batch.id, grade.id, etc.) |

### `group_user`
Junction table linking users to groups.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| group_id | string | FK to `group.id` |
| user_id | string | FK to `user.id` |

## Custom Tables (Created by this app)

### `user_permission`
Stores user access permissions for this CRUD UI. See [permissions.md](permissions.md) for how these columns drive the three-layer permission model.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| email | varchar(255) | User email (unique) |
| role | varchar(50) | `teacher`, `program_manager`, `program_admin`, or `admin` (default: `teacher`) |
| level | integer | 1=School, 2=Region, 3=All Schools |
| school_codes | text[] | Array of school codes (for level 1) |
| regions | text[] | Array of region names (for level 2) |
| program_ids | integer[] | Array of program IDs the user is assigned to (1=CoE, 2=Nodal, 64=NVS) |
| read_only | boolean | If true, downgrades edit access to view |
| inserted_at | timestamp | |
| updated_at | timestamp | |

## Common Queries

### Get students for a school
```sql
SELECT
  gu.id as group_user_id,
  u.id as user_id,
  u.first_name, u.last_name, u.phone, u.email, u.gender,
  s.student_id, s.apaar_id, s.category, s.stream, s.status,
  gr.number as grade,
  p.name as program_name
FROM group_user gu
JOIN "group" g ON gu.group_id = g.id
JOIN "user" u ON gu.user_id = u.id
LEFT JOIN student s ON s.user_id = u.id
LEFT JOIN grade gr ON s.grade_id = gr.id
LEFT JOIN LATERAL (
  SELECT p.name
  FROM group_user gu_batch
  JOIN "group" g_batch ON gu_batch.group_id = g_batch.id AND g_batch.type = 'batch'
  JOIN batch b ON g_batch.child_id = b.id
  JOIN program p ON b.program_id = p.id
  WHERE gu_batch.user_id = u.id
  LIMIT 1
) p ON true
WHERE g.type = 'school' AND g.child_id = $1
ORDER BY gr.number, u.first_name, u.last_name
```

### Get all JNV schools
```sql
SELECT id, code, name, district, state, region
FROM school
WHERE af_school_category = 'JNV'
ORDER BY name
```

### Get schools by region
```sql
SELECT code FROM school
WHERE af_school_category = 'JNV'
  AND region = ANY($1)
```

### Get distinct regions
```sql
SELECT region, COUNT(*) as school_count
FROM school
WHERE af_school_category = 'JNV' AND region IS NOT NULL AND region != ''
GROUP BY region
ORDER BY region
```

## DB Service API Endpoints

The DB Service (https://staging-db.avantifellows.org/api) is the canonical data layer.

### Update Student
```
POST /student
Content-Type: application/json
Authorization: Bearer {token}

{
  "student_id": "22116002",  // or "apaar_id"
  "first_name": "...",
  "last_name": "...",
  "phone": "...",
  "gender": "...",
  "category": "...",
  "stream": "..."
}
```

### Mark Student as Dropout
```
PATCH /dropout/{student_id}
Content-Type: application/json
Authorization: Bearer {token}

{
  "start_date": "2025-11-27",
  "academic_year": "2025-2026"
}
```

**Response codes:**
- 200: Success
- 400: `{"errors": "Student is already marked as dropout"}`

## Notes

1. **Group system**: A user can belong to multiple groups (school, batch, grade). The `group_user` table creates these associations.

2. **Student enrollment**: To enroll a student in a school:
   - Create user in `user` table
   - Create student record in `student` table
   - Create group_user entries for school, batch, grade, auth_group

3. **JNV filtering**: Most queries filter by `af_school_category = 'JNV'` to only show Jawahar Navodaya Vidyalaya schools.

4. **Grade linkage**: Grade is linked via `student.grade_id -> grade.id`, NOT through the group system.

5. **Program linkage**: Program is accessed via `batch.program_id -> program.id`. Students are linked to batches via the group system.
