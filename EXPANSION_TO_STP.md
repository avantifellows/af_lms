# Expanding to STP (TP-Sync) Product

This document outlines the architecture changes needed to support multiple products (JNV and STP/TP-Sync) where students are organized differently.

## Current State (JNV Only)

### Data Organization
- Students belong to **schools**
- Schools are filtered by `af_school_category = 'JNV'`
- Permissions grant access to schools (by code) or regions

### Permission Levels
| Level | Access |
|-------|--------|
| 4 | Admin (all schools + user management) |
| 3 | All JNV schools |
| 2 | Schools in specific regions |
| 1 | Specific school codes |

*Note: Currently Level 4 is product-specific. There's no "super admin" that spans all products.*

### User Flow
```
Login → Dashboard (list of schools) → School Page (list of students)
```

---

## Target State (Multi-Product)

### Key Difference: STP Organization
- STP students belong to **programs/batches**, not schools
- A student may be in multiple batches
- Access should be granted by **program**, not school

### Proposed Data Organization
```
JNV Product:
  └── Schools
       └── Students (via group_user where group.type = 'school')

STP Product:
  └── Programs
       └── Batches
            └── Students (via group_user where group.type = 'batch')
```

---

## Database Changes

### 1. Add Product Table (NOT NEEDED - ALREADY IN DB)

```sql
CREATE TABLE product (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,  -- 'jnv', 'stp'
  name VARCHAR(255) NOT NULL,        -- 'JNV Schools', 'TP-Sync'
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO product (code, name) VALUES
  ('jnv', 'JNV Schools'),
  ('stp', 'TP-Sync');
```

### 2. Modify user_permission Table

```sql
-- Add product scope to permissions
ALTER TABLE user_permission
ADD COLUMN product_code VARCHAR(50),  -- NULL = all products, or specific product
ADD COLUMN program_ids INTEGER[];      -- For STP: specific program access

-- Add index for product filtering
CREATE INDEX idx_user_permission_product ON user_permission(product_code);
```

### 3. New Permission Schema

```sql
CREATE TABLE user_permission (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  
  -- Global admin flag (supersedes all other permissions)
  is_super_admin BOOLEAN DEFAULT false,
  
  -- Product scope (ignored if is_super_admin = true)
  product_code VARCHAR(50),           -- NULL = all products user has access to, 'jnv', 'stp'
  
  -- Access level within product
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3, 4)),
  
  -- JNV-specific access (level 1-2)
  school_codes TEXT[],                -- Level 1: specific schools
  regions TEXT[],                     -- Level 2: specific regions
  
  -- STP-specific access (level 1-2)
  program_ids INTEGER[],              -- Level 1: specific programs
  -- (Level 2 for STP could be by category/type of program if needed)
  
  read_only BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 4. Permission Level Meanings (Updated)

| Level | Scope | JNV Access | STP Access |
|-------|-------|------------|------------|
| **Super Admin** | Global | All products + all user management | All products + all user management |
| 4 | Product | Admin (all + user mgmt for product) | Admin (all + user mgmt for product) |
| 3 | Product | All JNV schools | All STP programs |
| 2 | Product | Schools in regions[] | (Future: program categories) |
| 1 | Product | Specific school_codes[] | Specific program_ids[] |

### 5. Super Admin vs Product Admin

| Capability | Super Admin | Product Admin (Level 4) |
|------------|-------------|-------------------------|
| View all products | Yes | Only their product |
| Manage users for all products | Yes | Only their product |
| Create other super admins | Yes | No |
| Create product admins | Yes | Yes (for their product) |
| Access all entities | Yes (all products) | Yes (their product only) |

**Use cases:**
- **Super Admin**: Engineering team, CTO, platform owner
- **Product Admin**: JNV program lead, STP program lead

---

## Backend Changes

### 1. Update Permission Logic

**File: `src/lib/permissions.ts`**

```typescript
// Current
export async function getAccessibleSchoolCodes(email: string): Promise<string[] | "all">

// New: Product-aware permissions
export async function getUserPermission(email: string): Promise<UserPermission | null>

export async function isSuperAdmin(email: string): Promise<boolean>

export async function getAccessibleProducts(email: string): Promise<Product[]>

export async function getAccessibleEntities(
  email: string,
  product: 'jnv' | 'stp'
): Promise<{
  type: 'all' | 'specific';
  schoolCodes?: string[];      // For JNV
  programIds?: number[];       // For STP
}>

export async function canAccessSchool(email: string, schoolCode: string): Promise<boolean>
export async function canAccessProgram(email: string, programId: number): Promise<boolean>

// Admin checks
export async function canManageUsers(email: string, product?: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  if (!permission) return false;
  
  // Super admins can manage all users
  if (permission.is_super_admin) return true;
  
  // Product admins can only manage users for their product
  if (permission.level === 4) {
    return !product || permission.product_code === product;
  }
  
  return false;
}

export async function canCreateAdmin(
  email: string, 
  targetLevel: number,
  targetProduct?: string
): Promise<boolean> {
  const permission = await getUserPermission(email);
  if (!permission) return false;
  
  // Only super admins can create other super admins
  if (targetLevel === 5 || !targetProduct) {  // 5 = super admin
    return permission.is_super_admin;
  }
  
  // Super admins can create any product admin
  if (permission.is_super_admin) return true;
  
  // Product admins can create lower-level users for their product
  if (permission.level === 4 && permission.product_code === targetProduct) {
    return targetLevel < 4;
  }
  
  return false;
}
```

### 2. Add Product Context

**File: `src/lib/product-context.ts`** (new)

```typescript
export type Product = 'jnv' | 'stp';

export interface ProductConfig {
  code: Product;
  name: string;
  entityType: 'school' | 'program';
  entityLabel: string;           // "School" or "Program"
  entityPluralLabel: string;     // "Schools" or "Programs"
  studentGroupType: string;      // group.type value: 'school' or 'batch'
}

export const PRODUCTS: Record<Product, ProductConfig> = {
  jnv: {
    code: 'jnv',
    name: 'JNV Schools',
    entityType: 'school',
    entityLabel: 'School',
    entityPluralLabel: 'Schools',
    studentGroupType: 'school',
  },
  stp: {
    code: 'stp',
    name: 'TP-Sync',
    entityType: 'program',
    entityLabel: 'Program',
    entityPluralLabel: 'Programs',
    studentGroupType: 'batch',
  },
};
```

### 3. New API Routes

```
Current:
  /api/students/search     - Search across schools

New:
  /api/[product]/entities           - List schools (JNV) or programs (STP)
  /api/[product]/entities/[id]      - Get entity details
  /api/[product]/students/search    - Search within product
```

Or simpler approach with query params:
```
  /api/entities?product=jnv         - List schools
  /api/entities?product=stp         - List programs
  /api/entities/[id]?product=jnv    - Get school
  /api/entities/[id]?product=stp    - Get program
```

### 4. Update Student Query for STP

**Current (JNV):**
```sql
SELECT ... FROM group_user gu
JOIN "group" g ON gu.group_id = g.id
WHERE g.type = 'school' AND g.child_id = $1  -- school_id
```

**New (STP):**
```sql
SELECT ... FROM group_user gu
JOIN "group" g ON gu.group_id = g.id
JOIN batch b ON g.child_id = b.id
WHERE g.type = 'batch' AND b.program_id = $1  -- program_id
```

---

## Frontend Changes

### 1. URL Structure

```
Current:
  /dashboard              → List of schools
  /school/[udise]         → Students in school

New:
  /jnv/dashboard          → List of JNV schools
  /jnv/school/[udise]     → Students in school
  
  /stp/dashboard          → List of STP programs
  /stp/program/[id]       → Students in program (across batches)
  /stp/program/[id]/batch/[batchId]  → Students in specific batch (optional)
```

### 2. App Directory Structure

```
src/app/
├── page.tsx                    # Login (unchanged)
├── [product]/                  # Dynamic product route
│   ├── layout.tsx              # Product-specific layout/nav
│   ├── dashboard/
│   │   └── page.tsx            # List entities (schools or programs)
│   ├── school/                 # JNV only
│   │   └── [udise]/
│   │       └── page.tsx
│   └── program/                # STP only
│       └── [id]/
│           └── page.tsx
├── admin/                      # Admin (cross-product)
│   └── users/
│       └── page.tsx            # Now includes product selection
└── api/
    ├── [product]/
    │   ├── entities/
    │   └── students/
    └── admin/
```

### 3. Component Changes

**Dashboard Page (Generalized)**

```typescript
// src/app/[product]/dashboard/page.tsx

interface PageProps {
  params: Promise<{ product: 'jnv' | 'stp' }>;
}

export default async function DashboardPage({ params }: PageProps) {
  const { product } = await params;
  const config = PRODUCTS[product];
  
  // Fetch entities based on product
  const entities = product === 'jnv' 
    ? await getSchools(...)
    : await getPrograms(...);
  
  return (
    <div>
      <h1>{config.entityPluralLabel}</h1>
      <EntityList entities={entities} product={product} />
    </div>
  );
}
```

**Entity List Component (New)**

```typescript
// src/components/EntityList.tsx

interface EntityListProps {
  entities: School[] | Program[];
  product: Product;
}

export function EntityList({ entities, product }: EntityListProps) {
  const config = PRODUCTS[product];
  const linkPrefix = product === 'jnv' ? '/jnv/school' : '/stp/program';
  
  return (
    <table>
      <thead>
        <tr>
          <th>{config.entityLabel} Name</th>
          {product === 'jnv' && <th>District</th>}
          {product === 'stp' && <th>Type</th>}
          <th>Students</th>
        </tr>
      </thead>
      {/* ... */}
    </table>
  );
}
```

### 4. Navigation Changes

**Product Switcher (Header)**

```typescript
// src/components/ProductSwitcher.tsx

export function ProductSwitcher({ current }: { current: Product }) {
  const userProducts = useUserProducts(); // Products user has access to
  
  return (
    <select value={current} onChange={...}>
      {userProducts.map(p => (
        <option key={p.code} value={p.code}>{p.name}</option>
      ))}
    </select>
  );
}
```

### 5. Admin User Management Updates

**Add User Modal Changes:**
- Add "Product" dropdown (JNV, STP, or All)
- Conditionally show School/Region fields (JNV) or Program fields (STP)

```typescript
// When product = 'jnv'
<SchoolSelector ... />
<RegionSelector ... />

// When product = 'stp'  
<ProgramSelector ... />
```

---

## Implementation Steps

### Phase 1: Database & Backend Foundation
1. [ ] Create `product` table
2. [ ] Add `product_code` and `program_ids` to `user_permission` table
3. [ ] Update permission functions to be product-aware
4. [ ] Add product config file

### Phase 2: API Layer
5. [ ] Create generic entity fetching functions (schools/programs)
6. [ ] Update student query to support batch-based lookup (STP)
7. [ ] Add product parameter to existing APIs or create new routes

### Phase 3: Frontend - Routing
8. [ ] Restructure to `[product]/` dynamic routes
9. [ ] Create product-specific layouts
10. [ ] Update navigation components

### Phase 4: Frontend - Components
11. [ ] Generalize Dashboard to EntityList
12. [ ] Create ProgramList component (similar to SchoolList)
13. [ ] Update StudentTable to work with both products
14. [ ] Add ProductSwitcher to header

### Phase 5: Admin Updates
15. [ ] Update AddUserModal with product selection
16. [ ] Add ProgramSelector component
17. [ ] Update permission display in user list

### Phase 6: Testing & Migration
18. [ ] Write migration script for existing permissions (set product_code = 'jnv')
19. [ ] Test JNV flow still works
20. [ ] Test STP flow end-to-end
21. [ ] Update documentation

---

## Migration Strategy

### For Existing Users

```sql
-- Set all existing permissions to JNV product
UPDATE user_permission 
SET product_code = 'jnv' 
WHERE product_code IS NULL;
```

### For Existing Sessions
- Existing sessions continue to work
- Users see only JNV until granted STP access

---

## Open Questions

1. **STP Level 2**: What should region-equivalent be for STP? Program category? State?

2. **Cross-product users**: Can a user have different levels for different products?
   - Option A: One row per product (cleaner)
   - Option B: Single row with product-specific fields (current direction)

3. **Student overlap**: Students may appear in both JNV and STP. How to handle?
   - Currently: Same student shows in both products based on their group memberships
   - This is probably fine - they're different views of the same student

4. **URL design**: 
   - Option A: `/jnv/dashboard`, `/stp/dashboard` (product in path)
   - Option B: `/dashboard?product=jnv` (product in query)
   - Recommendation: Option A (cleaner URLs, better for bookmarking)

5. **Default product**: When user has access to multiple products, which to show first?
   - Show product switcher on login
   - Or remember last used product

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Database & Backend | 4-6 hours |
| Phase 2: API Layer | 3-4 hours |
| Phase 3: Frontend Routing | 3-4 hours |
| Phase 4: Frontend Components | 4-6 hours |
| Phase 5: Admin Updates | 2-3 hours |
| Phase 6: Testing & Migration | 3-4 hours |
| **Total** | **19-27 hours** |

---

## Future Considerations

- **More products**: Architecture supports adding more products easily
- **Product-specific fields**: Some student fields may only apply to certain products
- **Reporting**: May need product-aware analytics/reports
- **Audit logging**: Track which product actions were performed in
