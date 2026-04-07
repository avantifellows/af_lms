# Avanti Fellows — UI Style Guide

> **Purpose:** Reference document for the CRUD UI design system. Covers colors, typography, spacing, components, layout patterns, and code examples.

> **Design Language:** Warm Professional — Avanti Brand Orange
>
> **Font:** Inter (loaded via `next/font/google`)
>
> **Icons:** `lucide-react` (installed, migration in progress)
>
> **Shared Components:** `src/components/ui/` — thin Tailwind wrappers for consistency

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing & Sizing](#4-spacing--sizing)
5. [Shared Components](#5-shared-components)
6. [Page Layouts](#6-page-layouts)
7. [Headers & Navigation](#7-headers--navigation)
8. [Cards & Panels](#8-cards--panels)
9. [Buttons](#9-buttons)
10. [Form Inputs](#10-form-inputs)
11. [Tables](#11-tables)
12. [Status Badges & Pills](#12-status-badges--pills)
13. [Modals & Dialogs](#13-modals--dialogs)
14. [Visit Form Components](#14-visit-form-components)
15. [Responsive & Mobile](#15-responsive--mobile)

---

## 1. Design Philosophy

The Avanti Fellows UI follows **Warm Professional** design principles:

- **Rounded corners** (`rounded-lg`) on all cards, buttons, inputs, and form sections — approachable, modern.
- **Soft shadows** (`shadow-sm`, `shadow`, `shadow-xl`) for depth and card separation.
- **Thick accent borders** define hierarchy. 2px for page headers, 4px for section dividers.
- **Uppercase headings** with `tracking-wide` or `tracking-tight` for structured feel.
- **Monospace numbers.** Numeric data always uses `font-mono` — stat cards, dates, counts, emails.
- **48px minimum touch targets** on all interactive elements (buttons, radio labels, tab items).
- **Hover + active states** on every interactive element — things feel alive.
- **Brand orange accent** (#D77C11) from the Avanti Fellows website palette.
- **No blue anywhere** — all interactive colors use accent tokens, not hardcoded Tailwind blue.

---

## 2. Color System

All colors are defined as CSS custom properties in `src/app/globals.css` under `:root`, then mapped to Tailwind via the `@theme inline` block. Use the Tailwind class names (e.g., `bg-accent`, `text-text-primary`), never raw hex values.

### Brand Palette (from avantifellows.org)

| Color | Hex | Role |
|-------|-----|------|
| Primary Coral | `#E96D57` | Danger/error states |
| Primary Gold | `#FFD063` | Warning states |
| Primary Amber | `#FFB763` | Hover backgrounds |
| Primary Salmon | `#FF9683` | Decorative (unused in UI) |
| Primary Blue | `#9AC4FA` | Info states |
| Secondary Deep Amber | `#9F5600` | Accent hover, warning text |
| Secondary Orange | `#D77C11` | **Primary accent** — buttons, links, borders |
| Secondary Charcoal | `#3C3C3C` | Primary text |
| White | `#FFFFFF` | Backgrounds, text on accent |

### Design Tokens

#### Accent

| Token | Class | Value | Usage |
|-------|-------|-------|-------|
| `accent` | `bg-accent`, `text-accent`, `border-accent` | `#D77C11` | Primary buttons, active states, links, borders |
| `accent-hover` | `bg-accent-hover`, `text-accent-hover` | `#9F5600` | Hover states for accent elements |
| `text-on-accent` | `text-text-on-accent` | `#FFFFFF` | White text on accent backgrounds |

#### Backgrounds

| Token | Class | Value | Usage |
|-------|-------|-------|-------|
| `bg` | `bg-bg` | `#FAFAF8` | Page background (warm off-white) |
| `bg-card` | `bg-bg-card` | `#FFFFFF` | Card/panel background |
| `bg-card-alt` | `bg-bg-card-alt` | `#FFF8F0` | Table headers, disabled inputs, alt rows |
| `bg-input` | `bg-bg-input` | `#FFFFFF` | Input field background |
| `hover-bg` | `bg-hover-bg` | `rgba(255, 183, 99, 0.12)` | Row/item hover background |

#### Text

| Token | Class | Value | Usage |
|-------|-------|-------|-------|
| `text-primary` | `text-text-primary` | `#3C3C3C` | Headings, main content |
| `text-secondary` | `text-text-secondary` | `#5C564F` | Supporting text |
| `text-muted` | `text-text-muted` | `#757069` | Labels, captions, metadata (WCAG AA compliant) |

#### Borders

| Token | Class | Value | Usage |
|-------|-------|-------|-------|
| `border` | `border-border` | `#E5E2DC` | Default borders (warm gray) |
| `border-accent` | `border-border-accent` | `#D77C11` | Accent borders (headers, progress bars) |

#### Status Colors

| Token | Class | Value | Usage |
|-------|-------|-------|-------|
| `danger` | `bg-danger`, `text-danger` | `#E96D57` | Errors, destructive actions |
| `danger-bg` | `bg-danger-bg` | `rgba(233, 109, 87, 0.08)` | Light danger background |
| `success` | `text-success` | `#16a34a` | Success states |
| `success-bg` | `bg-success-bg` | `rgba(22, 163, 74, 0.08)` | Light success background |
| `warning-bg` | `bg-warning-bg` | `rgba(255, 208, 99, 0.2)` | Warning background |
| `warning-border` | `border-warning-border` | `#FFD063` | Warning border |
| `warning-text` | `text-warning-text` | `#9F5600` | Warning text |
| `info` | `text-info` | `#9AC4FA` | Info states |
| `info-bg` | `bg-info-bg` | `rgba(154, 196, 250, 0.15)` | Light info background |

### Semantic Category Colors (exceptions)

These retain distinct Tailwind colors since each color conveys a different category — do NOT unify these to accent:

- **Program badges**: CoE = purple, Nodal = accent, NVS = green
- **Role badges**: admin = purple, program_admin = cyan, program_manager = indigo, teacher = gray
- **Student category badges**: Gen = green, OBC = accent, SC = purple, ST = orange

---

## 3. Typography

### Font

**Inter** — loaded via `next/font/google` in `src/app/layout.tsx`. Applied as `--font-inter` CSS variable, falling back to `Arial, Helvetica, sans-serif`.

### Scale

| Element | Classes | Example |
|---------|---------|---------|
| Page title | `text-xl sm:text-2xl font-bold uppercase tracking-tight` | SCHOOLS, VISITS, ADMIN |
| Section heading | `text-lg font-bold uppercase tracking-wide` | MY SCHOOLS, IN PROGRESS |
| Card title | `text-lg font-bold uppercase tracking-wide` | USER MANAGEMENT |
| Form label | `text-xs font-bold uppercase tracking-wide text-text-muted` | SCHOOL CODE, STATUS |
| Body text | `text-sm text-text-primary` | Default content |
| Supporting text | `text-sm text-text-secondary` | Descriptions |
| Metadata | `text-xs text-text-muted` | Timestamps, codes |
| Data values | `text-3xl font-bold font-mono` | 675, 0 (stat cards) |
| Dates/numbers | `font-mono` | 30 Mar 2026, email addresses |

### Rules

- **Uppercase + tracking** for headings and labels — structured, professional feel.
- **`font-mono`** for all numeric data, dates, emails, counts — data-rich look.
- **Never ALL CAPS on body text** — only headings, labels, buttons, badges.

---

## 4. Spacing & Sizing

### Touch Targets

All interactive elements must meet **48px minimum** (Google/Apple standard):

| Element | Implementation |
|---------|---------------|
| Buttons (md) | `min-h-[44px]` |
| Buttons (lg) | `min-h-[48px]` |
| Inputs/Selects | `min-h-[44px]` via `baseInputClasses` |
| Radio labels | `min-h-[48px]` with `px-3 py-2` padding |
| Tab items | `min-h-[48px]` with `py-3` padding |

### Border Radius Scale

| Element | Radius |
|---------|--------|
| Buttons | `rounded-lg` |
| Cards | `rounded-lg` (sm/md), `rounded-xl` (modal) |
| Inputs/Selects | `rounded-lg` |
| Form sections | `rounded-lg` |
| Badges | `rounded-full` |
| Modals | `rounded-lg` |

### Shadow Scale

| Elevation | Class | Usage |
|-----------|-------|-------|
| Subtle | `shadow-sm` | Form sections, sticky bars, secondary cards |
| Default | `shadow` | Primary cards (with `hover:shadow-md`) |
| Prominent | `shadow-xl` | Modals |

---

## 5. Shared Components

All shared components live in `src/components/ui/`. Import from `@/components/ui`.

### Button

```tsx
import { Button } from "@/components/ui";

<Button>Primary</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="ghost">Link style</Button>
<Button variant="danger">Delete</Button>
<Button variant="danger-ghost">Remove</Button>
<Button variant="icon">X</Button>

<Button size="sm">Small</Button>  // min-h 36px
<Button size="md">Medium</Button> // min-h 44px (default)
<Button size="lg">Large</Button>  // min-h 48px
```

All variants include: `rounded-lg`, `transition-colors`, `focus-visible:ring-2`, `disabled:opacity-50`.

### Card

```tsx
import { Card } from "@/components/ui";

<Card className="p-6">Default (shadow, hover:shadow-md)</Card>
<Card elevation="sm" className="p-4">Subtle (shadow-sm, no hover)</Card>
<Card elevation="xl" className="p-8">Modal-level (shadow-xl, rounded-xl)</Card>
```

All elevations include: `bg-bg-card`, `rounded-lg`, `border border-border`.

### Input / Select

```tsx
import { Input, Select } from "@/components/ui";

<Input placeholder="Search..." />
<Select><option>All</option></Select>
```

Both include: `rounded-lg`, `min-h-[44px]`, `border-2 border-border`, `focus:border-accent focus:ring-2 focus:ring-accent/20`, `disabled:bg-bg-card-alt`.

### Badge

```tsx
import { Badge } from "@/components/ui";

<Badge>Default (gray)</Badge>
<Badge variant="accent">Accent</Badge>
<Badge variant="success">Success</Badge>
<Badge variant="warning">Warning</Badge>
<Badge variant="danger">Danger</Badge>
<Badge variant="info">Info</Badge>
```

### Modal

```tsx
import { Modal } from "@/components/ui";

<Modal open={isOpen} onClose={() => setIsOpen(false)}>
  <div className="p-6">Content here</div>
</Modal>
```

Includes: backdrop (`bg-black/30`), Escape key handler, `z-50` (or `z-40` for secondary).

### Visit Form Components

```tsx
import { FormSection, FormLabel, StickyProgressBar, RadioPair, RemarkField } from "@/components/ui";

<StickyProgressBar>2/7 completed</StickyProgressBar>

<FormSection>  {/* rounded-lg border shadow-sm p-4 space-y-4 */}
  <FormLabel>Question</FormLabel>
  <RadioPair name="q1" value={answer} onChange={setAnswer} />
  <RemarkField value={remark} onChange={setRemark} />
</FormSection>

<FormSection spacing="">  {/* no space-y-4 */}
  Custom spacing content
</FormSection>
```

### Utility

```tsx
import { isPlainObject } from "@/lib/visit-form-utils";
```

Extracted from 8 visit form files — single source of truth.

---

## 6. Page Layouts

### Standard page structure

```tsx
<div className="min-h-screen bg-bg">
  <header className="bg-bg-card border-b-2 border-accent shadow-sm">
    {/* Nav bar content */}
  </header>
  <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    {/* Page content */}
  </main>
</div>
```

### Visit form pages (narrower)

```tsx
<main className="px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">
```

---

## 7. Headers & Navigation

### Main app header (Dashboard, Visits)

```tsx
<header className="bg-bg-card border-b-2 border-accent shadow-sm">
  <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
    <div className="flex items-center gap-6">
      <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">
        Schools
      </h1>
      <nav className="flex gap-4">
        {/* Active tab */}
        <Link className="text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-1">
          Schools
        </Link>
        {/* Inactive tab */}
        <Link className="text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-1">
          Visits
        </Link>
      </nav>
    </div>
    <div className="flex items-center gap-4">
      <Link className="text-sm font-bold text-accent hover:text-accent-hover uppercase">Admin</Link>
      <span className="text-sm text-text-muted font-mono hidden sm:inline">{email}</span>
      <Link className="text-sm font-bold text-danger hover:text-danger/80">Sign out</Link>
    </div>
  </div>
</header>
```

### Sub-page header (Admin sub-pages, School detail)

Uses `PageHeader` component (`src/components/PageHeader.tsx`) with back arrow, uppercase title, subtitle, sign out link. Same `bg-bg-card border-b-2 border-accent shadow-sm` pattern.

### Section dividers

```tsx
{/* Thick accent border for major sections */}
<div className="border-b-4 border-border-accent pb-4 mb-6">
  <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Section Title</h2>
</div>

{/* Thinner accent border for subsections */}
<h2 className="border-b-2 border-border-accent pb-2 mb-4 text-lg font-bold uppercase tracking-wide">
  Subsection
</h2>
```

---

## 8. Cards & Panels

Use the `<Card>` component. Always pass padding via `className`.

```tsx
<Card className="p-6">Standard card</Card>
<Card elevation="sm" className="p-4">Subtle card (tables, filters)</Card>
<Card elevation="xl" className="p-8">Modal-level card</Card>
```

### Stat cards

```tsx
<Card className="p-6">
  <div className="text-xs font-bold text-text-muted uppercase tracking-wide">My Schools</div>
  <div className="mt-1 text-3xl font-bold text-text-primary font-mono">675</div>
</Card>
```

---

## 9. Buttons

Use the `<Button>` component for all buttons. For `<Link>` elements styled as buttons, apply matching classes manually with `rounded-lg`:

```tsx
{/* Button component */}
<Button>Submit</Button>
<Button variant="secondary">Cancel</Button>

{/* Link styled as button */}
<Link className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-bold text-text-on-accent bg-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90 transition-colors">
  Start Visit
</Link>
```

---

## 10. Form Inputs

Use `<Input>` and `<Select>` from shared components. For visit forms, also use `<FormLabel>`, `<RadioPair>`, `<RemarkField>`.

```tsx
<FormLabel htmlFor="code">School Code</FormLabel>
<Input id="code" placeholder="e.g. 70705" />

<FormLabel htmlFor="status">Status</FormLabel>
<Select id="status">
  <option>All</option>
</Select>
```

---

## 11. Tables

```tsx
<Card elevation="sm" className="overflow-hidden">
  <table className="min-w-full">
    <thead className="bg-bg-card-alt border-b-2 border-border-accent">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
          Column
        </th>
      </tr>
    </thead>
    <tbody className="bg-bg-card">
      <tr className="border-b border-border/40 hover:bg-hover-bg">
        <td className="px-6 py-4 text-sm text-text-primary">Data</td>
      </tr>
    </tbody>
  </table>
</Card>
```

---

## 12. Status Badges & Pills

```tsx
<Badge variant="success">Completed</Badge>
<Badge variant="warning">In Progress</Badge>
<Badge variant="danger">Dropout</Badge>
<Badge>Default</Badge>
```

For semantic category badges (roles, programs, student categories) that use distinct colors for meaning, apply color classes directly rather than using Badge variants.

---

## 13. Modals & Dialogs

Use the `<Modal>` component:

```tsx
<Modal open={isOpen} onClose={() => setIsOpen(false)} className="max-w-md">
  <div className="p-6">
    <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Title</h2>
    {/* Content */}
    <div className="mt-6 flex gap-3 justify-end">
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button onClick={onSave}>Save</Button>
    </div>
  </div>
</Modal>
```

---

## 14. Visit Form Components

Visit forms are the most complex UI in the app. They use these shared components:

| Component | Purpose |
|-----------|---------|
| `<StickyProgressBar>` | Sticky top bar showing completion progress |
| `<FormSection>` | Bordered section with `rounded-lg shadow-sm p-4 space-y-4` |
| `<FormLabel>` | Uppercase muted label |
| `<RadioPair>` | Yes/No radio pair with 48px touch targets |
| `<RemarkField>` | Self-managing "Add remark" toggle + textarea |
| `<Select>` | Styled select dropdown |
| `isPlainObject()` | Utility for safe data parsing (`@/lib/visit-form-utils`) |

---

## 15. Responsive & Mobile

- **Progressive padding**: `px-4 sm:px-6 md:px-16 lg:px-32` for visit form pages
- **Grid breakpoints**: `sm:grid-cols-2 lg:grid-cols-3` for school card grids
- **Mobile card layouts**: Tables switch to card layout on `sm:hidden` breakpoint
- **Touch targets**: All interactive elements ≥44px (buttons/inputs) or ≥48px (radio labels, tabs)
- **Sticky bars**: `sticky top-12 z-10` for visit form progress bars
- **Tab overflow**: `overflow-x-auto` on tab bars for narrow screens
