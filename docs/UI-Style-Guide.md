# ADS Agrotech — UI Style Guide

> **Purpose:** Complete reference document for replicating the "Ledger UI" design system in other React + Tailwind projects. Covers colors, typography, spacing, components, layout patterns, and full code examples.

> **Design Language:** Modern Corporate Brutalist — Emerald Light Mode
>
> **Verified:** Cross-checked against the actual codebase by multiple agents. Discrepancies and exceptions are noted inline.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing & Sizing](#4-spacing--sizing)
5. [Tailwind Configuration](#5-tailwind-configuration)
6. [Global CSS](#6-global-css)
7. [Theme Object](#7-theme-object)
8. [Page Layouts](#8-page-layouts)
9. [Headers](#9-headers)
10. [Cards & Panels](#10-cards--panels)
11. [Buttons](#11-buttons)
12. [Form Inputs](#12-form-inputs)
13. [Tables](#13-tables)
14. [List Pages](#14-list-pages)
15. [Status Badges & Pills](#15-status-badges--pills)
16. [Modals & Dialogs](#16-modals--dialogs)
17. [Loading & Empty States](#17-loading--empty-states)
18. [Alerts & Errors](#18-alerts--errors)
19. [Navigation & Back Buttons](#19-navigation--back-buttons)
20. [Animations & Transitions](#20-animations--transitions)
21. [Responsive Design Rules](#21-responsive-design-rules)
22. [Icons](#22-icons)
23. [Progress Bars](#23-progress-bars)
24. [Collapsible Sections](#24-collapsible-sections)
25. [Reusable Component Reference](#25-reusable-component-reference)
26. [Full Page Examples](#26-full-page-examples)

---

## 1. Design Philosophy

The Ledger UI style follows **corporate brutalist** design principles:

- **Sharp corners on Ledger UI pages.** The core data pages (Dashboard, list pages, detail forms) use zero border-radius. However, some peripheral components (NavBar links, FileUpload, RegisterPage, LocationPickerModal, entity Card components, SearchBar) do use `rounded-md`, `rounded-lg`, `rounded-full`, or `rounded-2xl`. When adopting this style, use sharp corners for all main content and allow rounding only for small interactive elements (pills, dots, action sheets).
- **Thick accent borders** define hierarchy. 4px for page headers, 2px for section headers, 1px for dividers.
- **Uppercase headers** with letter-spacing create a structured, ledger-like feel.
- **Emerald green accent** (#059669) is the single brand color used for all interactive elements.
- **Monospace numbers.** Numeric data always uses `font-mono` for a data-rich, professional look.
- **Minimal shadows.** Ledger UI pages rely on borders rather than box-shadows for definition. Some peripheral components (modals, cards, FileUpload action sheets) do use `shadow-md`, `shadow-xl`, or `shadow-2xl`.
- **Full-bleed backgrounds.** Page backgrounds extend edge-to-edge with progressive padding for content.

---

## 2. Color System

### Primary Palette

| Token           | Hex                          | Usage                               |
|-----------------|------------------------------|--------------------------------------|
| `accent`        | `#059669`                    | Primary brand, buttons, borders, links |
| `accentHover`   | `#047857`                    | Hover state for accent elements      |
| `textOnAccent`  | `#FFFFFF`                    | White text on accent backgrounds     |

### Backgrounds

| Token           | Hex        | Usage                              |
|-----------------|------------|-------------------------------------|
| `bg`            | `#F0F7F4`  | Page background (soft green-tinted) |
| `bgCard`        | `#FFFFFF`  | Card/panel background               |
| `bgCardAlt`     | `#F5FAF7`  | Table headers, disabled inputs, alt rows |
| `bgInput`       | `#FFFFFF`  | Input field background              |
| `hoverBg`       | `#E6F2EC`  | Row/item hover background           |

### Text

| Token           | Hex        | Usage                    |
|-----------------|------------|---------------------------|
| `textPrimary`   | `#2A2A2A`  | Headings, main content    |
| `textSecondary` | `#6B6560`  | Subtitles, descriptions   |
| `textMuted`     | `#9A948D`  | Labels, placeholders, counts |

### Borders

| Token           | Hex        | Usage                       |
|-----------------|------------|------------------------------|
| `border`        | `#D1E7DD`  | Card borders, dividers       |
| `borderAccent`  | `#059669`  | Header bottom borders        |
| `progressBg`    | `#D1E7DD`  | Progress bar track           |

### Status Colors

> **Note:** These are NOT part of the base theme object. They are hardcoded inline or added as extra keys in only 2 specialized components (GuardModal, CheckinEditModal). Values vary slightly between components.

| Status    | Background                      | Border     | Text       |
|-----------|---------------------------------|------------|------------|
| Danger    | `rgba(239, 68, 68, 0.08)`      | `#FCA5A5`  | `#DC2626` or `#ef4444`  |
| Success   | `rgba(5, 150, 105, 0.08)`      | `#A7F3D0`  | `#047857`  |
| Warning   | `#fef3c7`                       | `#fcd34d`  | `#92400e`  |
| Deleted   | `rgba(239, 68, 68, 0.08)`      | —          | `#ef4444`  |

> **Inconsistency in codebase:** CheckinEditModal uses `dangerBg: '#FEF2F2'` and `dangerBorder: '#FECACA'` (different from above). Some components use `rgba(239, 68, 68, 0.1)` (10% opacity vs 8%). Standardize to the values above when adopting.

### Color Scale (Density Maps / Gradients)

```
#F0F7F4 → #D1FAE5 → #A7F3D0 → #6EE7B7 → #34D399 → #10B981 → #059669
(Low)                                                            (High)
```

---

## 3. Typography

### Font Stack

```css
/* Declared in component inline styles — but Inter is NOT actually loaded.
   The browser falls through to system sans-serif fonts. */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* Monospace - for numbers, phone numbers, codes */
font-family: font-mono; /* Tailwind's default mono stack */
```

> **Important:** Inter is referenced in 20+ components via inline `fontFamily` styles, but no `@font-face`, Google Fonts `<link>`, or `@import` loads it. The actual rendered font is the system sans-serif (`-apple-system` / `BlinkMacSystemFont` / `SF Pro` / `Segoe UI`). **For your revamp: explicitly load Inter from Google Fonts** to match the intended look.

### Local Font Files (Rajdhani)

The app includes Rajdhani as local custom fonts. These are used in the NavBar, RegisterPage, Profile, and other components via Tailwind custom classes:

| Tailwind Class      | Font File             | @font-face Name | Weight    |
|--------------------|-----------------------|-----------------|-----------|
| `font-primaryLight`    | `Rajdhani-Light.ttf`    | `PrimaryLight`    | Light     |
| `font-primaryRegular`  | `Rajdhani-Regular.ttf`  | `PrimaryRegular`  | Regular   |
| `font-primaryBold`     | `Rajdhani-Bold.ttf`     | `PrimaryBold`     | Bold      |
| `font-primarySemibold` | `Rajdhani-SemiBold.ttf` | `PrimarySemibold` | SemiBold  |
| _(no Tailwind class)_  | `Rajdhani-Medium.ttf`   | `PrimaryMedium`   | Medium    |

> **Caveats:**
> - `PrimaryMedium` has an `@font-face` declaration but **no matching Tailwind config entry**. It is still used directly via `font-primaryMedium` class in `Profile.tsx` (which works because Tailwind generates utility classes, but it won't be in the purge safelist).
> - The `@font-face` declares `PrimarySemiBold` (capital B) but the Tailwind config maps to `PrimarySemibold` (lowercase b). This casing mismatch means the font may not load correctly via the Tailwind class.
> - `font-primaryFat` and `font-primaryArista` are in Tailwind config but have no font files — unused.
>
> **For your revamp:** Load Inter from Google Fonts for body text. Optionally use Rajdhani for branding/headings.

### Typography Scale

| Element                | Classes                                          | Color Token     |
|------------------------|--------------------------------------------------|-----------------|
| Page Title             | `text-2xl sm:text-3xl md:text-4xl font-bold uppercase tracking-tight` | `textPrimary`   |
| Page Subtitle          | `mt-2 text-sm md:text-base`                      | `textSecondary` |
| Section Title          | `font-bold uppercase tracking-wide text-sm md:text-base` | `textPrimary`   |
| Section Subtitle       | `text-xs mt-0.5`                                 | `textMuted`     |
| Field Label            | `text-xs font-bold uppercase tracking-wide`      | `textMuted`     |
| Body Text              | `text-sm md:text-base`                           | `textPrimary`   |
| Small Text             | `text-xs md:text-sm`                             | `textSecondary` |
| Muted/Helper           | `text-sm`                                        | `textMuted`     |
| Large Numbers (KPI)    | `text-2xl sm:text-3xl md:text-4xl font-bold font-mono` | `textPrimary`   |
| Table Numbers          | `font-bold text-sm font-mono`                    | `accent`        |
| Badge Text             | `text-[9px] md:text-[10px] font-bold uppercase tracking-wide` | `textSecondary` |
| Button Text            | `text-base sm:text-lg font-bold uppercase tracking-wide` | `textOnAccent`  |
| Small Button Text      | `text-xs md:text-sm font-bold uppercase tracking-wide` | varies          |

### Key Rules

1. **ALL headers are uppercase** with `tracking-tight` or `tracking-wide`
2. **ALL numeric values use `font-mono`**
3. **ALL labels are uppercase** with `tracking-wide` or `tracking-wider`
4. **Sharp corners on Ledger UI pages** — data pages use zero border-radius (see [Design Philosophy](#1-design-philosophy) for exceptions)

---

## 4. Spacing & Sizing

### Border Widths

| Context          | Width  | Color Token    |
|------------------|--------|----------------|
| Page header      | `4px`  | `borderAccent` |
| Section header   | `2px`  | `borderAccent` |
| Input borders    | `2px`  | `border`       |
| Card borders     | `1px`  | `border`       |
| Row dividers     | `1px`  | `border`       |
| Faded dividers   | `1px`  | `border` + `40` opacity suffix |

### Common Padding Patterns

```
/* Card header */   px-4 md:px-6 py-3 md:py-4
/* Card body */     p-4 md:p-6
/* List row */      px-4 md:px-6 py-4 md:py-5
/* Button (full) */ px-4 sm:px-6 py-3 sm:py-4
/* Button (small)*/ px-3 md:px-4 py-1.5 md:py-2
/* Input */         px-3 py-2
/* Badge */         px-1.5 md:px-2 py-0.5 md:py-1
/* Modal header */  px-6 py-4
/* Modal body */    px-6 md:px-8 py-6
```

### Gap Patterns

```
/* KPI grid */      gap-3 md:gap-4
/* Panel grid */    gap-4 md:gap-6
/* Stats grid */    gap-2 md:gap-3
/* Button group */  gap-2
/* Badge group */   gap-2 md:gap-3
/* Stacked items */ space-y-3 or space-y-5
```

---

## 5. Tailwind Configuration

```javascript
// tailwind.config.js
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        primaryLight: ['PrimaryLight'],
        primaryBold: ['PrimaryBold'],
        primaryRegular: ['PrimaryRegular'],
        primarySemibold: ['PrimarySemibold'],
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'slide-up': 'slide-up 0.4s ease-out forwards',
        'scale-in': 'scale-in 0.3s ease-out forwards',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
```

---

## 6. Global CSS

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Remove focus rings on inputs and buttons */
input {
  --tw-ring-shadow: 0 0 #000 !important;
}
button {
  --tw-ring-shadow: 0 0 #000 !important;
}

/* Remove number input spinners */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type=number] {
  -moz-appearance: textfield;
}

/* Custom @font-face declarations (optional - for Rajdhani) */
@font-face {
  font-family: "PrimaryBold";
  src: url('./assets/fonts/Rajdhani-Bold.ttf') format('truetype');
}
@font-face {
  font-family: "PrimaryRegular";
  src: url('./assets/fonts/Rajdhani-Regular.ttf') format('truetype');
}
@font-face {
  font-family: "PrimaryMedium";
  src: url('./assets/fonts/Rajdhani-Medium.ttf') format('truetype');
}
@font-face {
  font-family: "PrimarySemiBold";
  src: url('./assets/fonts/Rajdhani-SemiBold.ttf') format('truetype');
}
@font-face {
  font-family: "PrimaryLight";
  src: url('./assets/fonts/Rajdhani-Light.ttf') format('truetype');
}

/* Remove Leaflet map focus outlines */
.leaflet-interactive:focus {
  outline: none !important;
}

/* Dashboard fade-in animation */
@keyframes fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
  animation: fade-in 0.5s ease-out forwards;
  opacity: 0;
}

/* Custom scrollbar (for lists) */
.dashboard-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.dashboard-scrollbar::-webkit-scrollbar-track {
  background: #F7F3EE;
  border-radius: 3px;
}
.dashboard-scrollbar::-webkit-scrollbar-thumb {
  background: #D8CFC3;
  border-radius: 3px;
}
.dashboard-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #FF7E33;
}

/* Root setup */
#root, html, body {
  height: 100%;
  margin: 0;
  padding: 0;
}
```

---

## 7. Theme Object

Most Ledger UI components define the same theme object inline. When adopting this design system, extract it to a shared constant.

> **Note:** The base 13 keys (accent through textMuted) are consistent across all 20+ Ledger UI components. `deletedBg` and `progressBg` are present in most but missing from a few (LoginPage, ManageValues). Status colors are only in 2 specialized components.

```typescript
// src/constants/theme.ts
export const theme = {
  // Accent (universal across all components)
  accent: '#059669',
  accentHover: '#047857',
  borderAccent: '#059669',
  textOnAccent: '#FFFFFF',

  // Backgrounds (universal)
  bg: '#F0F7F4',
  bgCard: '#FFFFFF',
  bgCardAlt: '#F5FAF7',
  bgInput: '#FFFFFF',
  hoverBg: '#E6F2EC',

  // Borders (universal)
  border: '#D1E7DD',
  progressBg: '#D1E7DD',

  // Text (universal)
  textPrimary: '#2A2A2A',
  textSecondary: '#6B6560',
  textMuted: '#9A948D',

  // Status (present in most but not all components)
  deletedBg: 'rgba(239, 68, 68, 0.08)',

  // Extended status (only in GuardModal/CheckinEditModal — include for completeness)
  dangerBg: 'rgba(239, 68, 68, 0.08)',
  dangerBorder: '#FCA5A5',
  dangerText: '#DC2626',
  dangerAccent: '#EF4444',
  successBg: 'rgba(5, 150, 105, 0.08)',
  successBorder: '#A7F3D0',
  successText: '#047857',
} as const;
```

---

## 8. Page Layouts

### Full-Bleed Page Wrapper

Every page uses this outer wrapper for edge-to-edge background:

```jsx
<div
  className="min-h-screen pt-[4rem]"
  style={{
    backgroundColor: theme.bg,
    width: '100vw',
    marginLeft: 'calc(-50vw + 50%)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  }}
>
  {/* Content container */}
</div>
```

- `pt-[4rem]` accounts for the fixed navbar (64px)
- `width: 100vw` + negative margin creates full-bleed background
- Font family is set on the page wrapper (not globally in some cases)

### Content Container (Responsive Padding)

Content is centered with progressive horizontal padding:

```jsx
<div className="w-full px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">
  {/* Page content */}
</div>
```

| Breakpoint | Horizontal Padding | Effective Content Width |
|------------|-------------------|------------------------|
| Mobile     | `px-4` (16px)     | ~full width            |
| `sm`       | `px-6` (24px)     | ~full width            |
| `md`       | `px-16` (64px)    | ~640px                 |
| `lg`       | `px-32` (128px)   | ~768px                 |
| `xl`       | `px-64` (256px)   | ~768px                 |
| `2xl`      | `px-96` (384px)   | ~768px                 |

### Login Page Layout (Centered Card)

```jsx
<div
  className="min-h-screen flex flex-col items-center justify-start py-8 px-4"
  style={{ backgroundColor: theme.bg }}
>
  <div className="w-full max-w-lg flex justify-end mb-4">
    {/* Language switcher */}
  </div>
  <div
    className="w-full max-w-lg"
    style={{
      backgroundColor: theme.bgCard,
      border: `1px solid ${theme.border}`,
    }}
  >
    {/* Card content */}
  </div>
</div>
```

---

## 9. Headers

### Page Header (With Accent Border)

```jsx
<header
  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8 pb-4 md:pb-6"
  style={{ borderBottom: `4px solid ${theme.borderAccent}` }}
>
  <div>
    <h1
      className="text-2xl sm:text-3xl md:text-4xl font-bold uppercase tracking-tight"
      style={{ color: theme.textPrimary }}
    >
      PAGE TITLE
    </h1>
    <p className="mt-2 text-sm md:text-base" style={{ color: theme.textSecondary }}>
      Description or subtitle text
    </p>
  </div>
  {/* Optional: action buttons on the right */}
</header>
```

**Key characteristics:**
- `4px solid` emerald bottom border
- Title is always `uppercase` with `tracking-tight`
- Responsive flex: stacks on mobile, row on `sm`+

### Title with Accent Span

A common pattern splits the title word to highlight part in accent color:

```jsx
<h1 className="text-2xl sm:text-3xl md:text-4xl font-bold uppercase tracking-tight"
    style={{ color: theme.textPrimary }}>
  Retail<span style={{ color: theme.accent }}>ers</span>
</h1>
```

---

## 10. Cards & Panels

### Basic Card

```jsx
<div style={{
  backgroundColor: theme.bgCard,
  border: `1px solid ${theme.border}`,
}}>
  {/* Content */}
</div>
```

**No rounded corners on Ledger UI data cards. No box-shadow.** Just a thin border on white. (Some peripheral components like entity cards, modals, and FileUpload do use rounding and shadows.)

### Panel (Card with Section Header)

```jsx
const Panel = ({ title, subtitle, children }) => (
  <div style={{ backgroundColor: theme.bgCard, border: `1px solid ${theme.border}` }}>
    {/* Section header */}
    <div
      className="px-4 md:px-6 py-3 md:py-4"
      style={{ borderBottom: `2px solid ${theme.borderAccent}` }}
    >
      <h2
        className="font-bold uppercase tracking-wide text-sm md:text-base"
        style={{ color: theme.textPrimary }}
      >
        {title}
      </h2>
      {subtitle && (
        <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>
          {subtitle}
        </p>
      )}
    </div>
    {/* Body */}
    <div className="p-4 md:p-6">
      {children}
    </div>
  </div>
);
```

**Key characteristics:**
- `2px solid` accent border below header
- Title: `font-bold uppercase tracking-wide`
- Subtitle: `text-xs` in muted color

### KPI Card

```jsx
const KpiCard = ({ label, value, pulse }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="relative p-3 sm:p-4 md:p-5 transition-colors"
      style={{
        backgroundColor: theme.bgCard,
        border: `1px solid ${isHovered ? `${theme.accent}80` : theme.border}`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className="text-xs sm:text-sm uppercase tracking-wider block"
        style={{ color: theme.textMuted }}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-2 mt-1">
        <span
          className={`text-2xl sm:text-3xl md:text-4xl font-bold font-mono ${pulse ? 'animate-pulse' : ''}`}
          style={{ color: theme.textPrimary }}
        >
          {value.toLocaleString()}
        </span>
        {pulse && value > 0 && (
          <span
            className="w-2 h-2 animate-ping"
            style={{ backgroundColor: theme.accent }}
          />
        )}
      </div>
    </div>
  );
};
```

**KPI Grid Layout:**
```jsx
<section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 mb-6 md:mb-8">
  <KpiCard label="METRIC 1" value={100} />
  <KpiCard label="METRIC 2" value={250} />
  <KpiCard label="LIVE NOW" value={5} pulse />
  {/* ... */}
</section>
```

---

## 11. Buttons

### Primary Button (Filled Accent)

```jsx
<button
  className="w-full px-4 sm:px-6 py-3 sm:py-4 text-base sm:text-lg font-bold uppercase tracking-wide transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
  style={{
    backgroundColor: isHovered && !disabled ? theme.accentHover : theme.accent,
    color: theme.textOnAccent,
    border: 'none',
  }}
  onMouseEnter={() => setIsHovered(true)}
  onMouseLeave={() => setIsHovered(false)}
  disabled={disabled}
>
  {isLoading && <ImSpinner8 className="animate-spin mr-2 h-6 w-6" />}
  Submit
</button>
```

### Secondary Button (Light Background)

```jsx
<button
  className="px-4 sm:px-6 py-3 sm:py-4 text-base sm:text-lg font-bold uppercase tracking-wide transition-colors"
  style={{
    backgroundColor: isHovered ? theme.hoverBg : theme.bgCardAlt,
    color: theme.textPrimary,
    border: `2px solid ${theme.border}`,
  }}
>
  Secondary Action
</button>
```

### Outline Button

```jsx
<button
  className="px-4 sm:px-6 py-3 sm:py-4 text-base sm:text-lg font-bold uppercase tracking-wide transition-colors"
  style={{
    backgroundColor: 'transparent',
    color: theme.accent,
    border: `2px solid ${isHovered ? theme.accentHover : theme.accent}`,
  }}
>
  Outline Action
</button>
```

### Small Action Button

```jsx
<button
  className="px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-bold uppercase tracking-wide transition-colors inline-flex items-center justify-center"
  style={{ backgroundColor: theme.accent, color: theme.textOnAccent }}
  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.accentHover)}
  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.accent)}
>
  Add New
</button>
```

### Danger/Delete Button

```jsx
<button
  className="px-3 md:px-4 py-1.5 md:py-2 font-bold uppercase text-xs md:text-sm border-2 transition-colors"
  style={{
    backgroundColor: isActive ? '#ef4444' : 'transparent',
    borderColor: '#ef4444',
    color: isActive ? '#FFFFFF' : '#ef4444',
  }}
>
  {isActive ? 'Done' : 'Delete'}
</button>
```

### Link/Text Button

```jsx
<button
  className="text-base uppercase tracking-wide font-bold transition-colors py-2"
  style={{ color: isHovered ? theme.accentHover : theme.accent }}
>
  Text Action
</button>
```

### Icon Button (Edit/Delete in rows)

```jsx
<button
  className="transition-colors"
  style={{ color: theme.textMuted }}
  onMouseEnter={(e) => { e.currentTarget.style.color = theme.accent; }}
  onMouseLeave={(e) => { e.currentTarget.style.color = theme.textMuted; }}
>
  <CiEdit className="h-6 w-6" />
</button>
```

### View Toggle Buttons

```jsx
<div className="flex gap-1 mb-4">
  {/* Active tab */}
  <button
    className="px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-bold uppercase tracking-wide"
    style={{ backgroundColor: theme.accent, color: theme.textOnAccent }}
  >
    Card View
  </button>
  {/* Inactive tab */}
  <button
    className="px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-bold uppercase tracking-wide transition-colors"
    style={{
      backgroundColor: theme.bgCardAlt,
      color: theme.textMuted,
      border: `1px solid ${theme.border}`,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderColor = `${theme.accent}80`;
      e.currentTarget.style.color = theme.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = theme.border;
      e.currentTarget.style.color = theme.textMuted;
    }}
  >
    Table View
  </button>
</div>
```

---

## 12. Form Inputs

### Text Input

```jsx
<input
  type="text"
  className="w-full px-3 py-2 text-sm md:text-base focus:outline-none transition-colors"
  style={{
    backgroundColor: theme.bgInput,
    border: `2px solid ${theme.border}`,
    color: theme.textPrimary,
  }}
  onFocus={(e) => (e.currentTarget.style.borderColor = theme.accent)}
  onBlur={(e) => (e.currentTarget.style.borderColor = theme.border)}
/>
```

**States:**
- Default: `2px solid #D1E7DD`
- Focused: `2px solid #059669`
- No rounded corners, no box-shadow

### Field Label

```jsx
<label className="text-xs font-bold uppercase tracking-wide mb-2 block"
       style={{ color: theme.textMuted }}>
  Field Name
  <span className="text-red-500 ml-1">*</span> {/* Required indicator */}
</label>
```

### Select Input

```jsx
<select
  className="w-full px-3 py-2 text-sm md:text-base focus:outline-none transition-colors"
  style={{
    backgroundColor: theme.bgInput,
    border: `2px solid ${theme.border}`,
    color: theme.textPrimary,
  }}
  onFocus={(e) => (e.currentTarget.style.borderColor = theme.accent)}
  onBlur={(e) => (e.currentTarget.style.borderColor = theme.border)}
>
  <option value="">Select...</option>
  <option value="1">Option 1</option>
</select>
```

**Disabled state:**
```jsx
style={{
  backgroundColor: theme.bgCardAlt,  // #F5FAF7
  border: `2px solid ${theme.border}`,
  color: theme.textMuted,            // #9A948D
}}
```

### Phone Input (With Country Code Prefix)

```jsx
<div
  className="flex items-center transition-colors"
  style={{
    border: `2px solid ${isFocused ? theme.accent : theme.border}`,
    backgroundColor: theme.bgInput,
  }}
>
  {/* Country code prefix */}
  <span
    className="flex-shrink-0 px-3 sm:px-5 py-3 sm:py-4 text-lg sm:text-xl font-bold font-mono"
    style={{
      backgroundColor: theme.bgCardAlt,
      color: theme.textPrimary,
      borderRight: `1px solid ${theme.border}`,
    }}
  >
    +91
  </span>
  {/* Input */}
  <input
    type="tel"
    className="flex-1 px-3 sm:px-5 py-3 sm:py-4 text-xl sm:text-2xl font-mono focus:outline-none"
    style={{ backgroundColor: 'transparent', color: theme.textPrimary }}
    inputMode="numeric"
    pattern="[0-9]*"
    maxLength={10}
    placeholder="9876543210"
  />
</div>
```

### OTP/PIN Input (With Visibility Toggle)

```jsx
<div
  className="relative flex items-center transition-colors"
  style={{
    border: `2px solid ${isFocused ? theme.accent : theme.border}`,
    backgroundColor: theme.bgInput,
  }}
>
  <input
    type={isVisible ? 'text' : 'password'}
    className="flex-1 px-3 sm:px-5 py-3 sm:py-4 text-xl sm:text-2xl font-mono focus:outline-none tracking-widest"
    style={{ backgroundColor: 'transparent', color: theme.textPrimary }}
    inputMode="numeric"
    pattern="[0-9]*"
    maxLength={4}
    placeholder="****"
  />
  <button
    className="px-4 transition-colors"
    style={{ color: theme.textMuted }}
    onMouseEnter={(e) => (e.currentTarget.style.color = theme.accent)}
    onMouseLeave={(e) => (e.currentTarget.style.color = theme.textMuted)}
  >
    {isVisible ? <EyeSlashIcon className="h-6 w-6" /> : <EyeIcon className="h-6 w-6" />}
  </button>
</div>
```

### Search Input

```jsx
<input
  type="text"
  placeholder="Search..."
  className="w-full max-w-md px-3 md:px-4 py-2 focus:outline-none transition-colors text-sm md:text-base"
  style={{
    backgroundColor: theme.bgInput,
    border: `2px solid ${theme.border}`,
    color: theme.textPrimary,
  }}
  onFocus={(e) => (e.currentTarget.style.borderColor = theme.accent)}
  onBlur={(e) => (e.currentTarget.style.borderColor = theme.border)}
/>
```

### Form Field Row (Detail/Edit Pages)

```jsx
<div
  className="py-4 flex flex-col"
  style={{ borderBottom: `1px solid ${theme.border}` }}
>
  <div className="text-xs font-bold uppercase tracking-wide mb-2"
       style={{ color: theme.textMuted }}>
    Field Label
    <span className="text-red-500 ml-1">*</span>
  </div>
  <div className="flex items-center">
    {/* Input or display value */}
  </div>
</div>
```

---

## 13. Tables

### Data Table

```jsx
<div className="overflow-x-auto">
  <table className="w-full">
    <thead>
      <tr style={{ borderBottom: `2px solid ${theme.borderAccent}` }}>
        <th
          className="py-3 text-left text-xs uppercase tracking-wider font-bold"
          style={{ color: theme.textMuted, backgroundColor: theme.bgCardAlt }}
        >
          Column Header
        </th>
        <th
          className="py-3 text-center text-xs uppercase tracking-wider font-bold"
          style={{ color: theme.textMuted, backgroundColor: theme.bgCardAlt }}
        >
          Numbers
        </th>
      </tr>
    </thead>
    <tbody>
      {data.map((row) => (
        <tr
          key={row.id}
          className="transition-colors"
          style={{ borderBottom: `1px solid ${theme.border}40` }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <td className="py-3 font-semibold" style={{ color: theme.textPrimary }}>
            {row.label}
          </td>
          <td className="py-3 text-center">
            <span
              className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 font-bold text-sm font-mono"
              style={{ backgroundColor: `${theme.accent}15`, color: theme.accent }}
            >
              {row.value}
            </span>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

**Key characteristics:**
- Header row: `2px` accent border, alt background, muted uppercase text
- Data rows: `1px` border with `40` opacity suffix (faded)
- Hover: background changes to `hoverBg`
- Numeric cells: accent-colored with `15` opacity background

---

## 14. List Pages

### Complete List Page Structure

```jsx
{/* List container */}
<div
  className="mt-6 md:mt-8 overflow-hidden"
  style={{ backgroundColor: theme.bgCard, border: `1px solid ${theme.border}` }}
>
  {/* Section header */}
  <div
    className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between"
    style={{ borderBottom: `2px solid ${theme.borderAccent}` }}
  >
    <h2 className="font-bold uppercase tracking-wide text-sm md:text-base"
        style={{ color: theme.textPrimary }}>
      Items
    </h2>
    <span className="text-xs md:text-sm" style={{ color: theme.textMuted }}>
      {items.length} items
    </span>
  </div>

  {/* List rows */}
  {items.map((item, index) => (
    <div
      key={item.id}
      className="px-4 md:px-6 py-4 md:py-5 flex flex-col lg:flex-row lg:items-center gap-3 md:gap-4 transition-colors"
      style={{
        borderBottom: `1px solid ${theme.border}`,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.hoverBg; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Row number + Name */}
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <span className="font-bold" style={{ color: theme.accent }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="font-bold text-base md:text-lg" style={{ color: theme.textPrimary }}>
            {item.name}
          </span>
          {/* Optional badge */}
          <span
            className="text-[9px] md:text-[10px] font-bold uppercase tracking-wide px-1.5 md:px-2 py-0.5 md:py-1"
            style={{ backgroundColor: theme.progressBg, color: theme.textSecondary }}
          >
            Badge
          </span>
        </div>

        {/* Secondary info row */}
        <div className="flex items-center flex-wrap gap-2 md:gap-3 mt-2 text-xs md:text-sm">
          <span className="font-mono" style={{ color: theme.textPrimary }}>
            +91 98765 43210
          </span>
          {/* Dot separator */}
          <span className="w-1 h-1 rounded-full hidden sm:block"
                style={{ backgroundColor: theme.border }} />
          <span className="truncate" style={{ color: theme.textSecondary }}>
            Location info
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3 mt-3">
          <div className="flex flex-row sm:flex-col sm:items-start items-center gap-1">
            <span className="text-[9px] md:text-xs uppercase tracking-wide"
                  style={{ color: theme.textMuted }}>
              Label
            </span>
            <span className="font-semibold text-xs md:text-sm"
                  style={{ color: theme.textPrimary }}>
              Value
            </span>
          </div>
        </div>
      </div>
    </div>
  ))}
</div>
```

**Key patterns:**
- Row indices are zero-padded (`01`, `02`, ...) in accent color
- Phone numbers use `font-mono`
- Dot separators (`w-1 h-1 rounded-full`) between inline items
- Stats layout: horizontal on mobile → vertical columns on `sm`+

---

## 15. Status Badges & Pills

### Designation Badge

```jsx
<span
  className="text-[9px] md:text-[10px] font-bold uppercase tracking-wide px-1.5 md:px-2 py-0.5 md:py-1"
  style={{ backgroundColor: theme.progressBg, color: theme.textSecondary }}
>
  MANAGER
</span>
```

### Deleted Badge

```jsx
<span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wide px-1.5 md:px-2 py-0.5 md:py-1 bg-red-500/20 text-red-500">
  DELETED
</span>
```

### Count Badge (Accent)

```jsx
<span
  className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 font-bold text-sm font-mono"
  style={{ backgroundColor: `${theme.accent}15`, color: theme.accent }}
>
  42
</span>
```

### Section Indicator Bar

Small colored bar used before section titles:

```jsx
<h3 className="text-sm md:text-base font-bold flex items-center gap-2 uppercase tracking-wide"
    style={{ color: theme.textPrimary }}>
  <span className="w-1 h-4" style={{ backgroundColor: theme.accent }} />
  SECTION TITLE
</h3>
```

---

## 16. Modals & Dialogs

### Modal Structure

```jsx
{/* Overlay */}
<div
  className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center"
  onClick={onClose}
  style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}
>
  {/* Modal container */}
  <div
    className="shadow-xl max-w-6xl w-full mx-4"
    style={{ backgroundColor: theme.bgCard }}
    onClick={(e) => e.stopPropagation()}
  >
    {/* Header */}
    <div className="px-6 py-4" style={{ borderBottom: `4px solid ${theme.borderAccent}` }}>
      <h3
        className="text-xl md:text-2xl font-bold uppercase tracking-tight"
        style={{ color: theme.textPrimary }}
      >
        Modal Title
      </h3>
      <p className="text-sm md:text-base mt-1" style={{ color: theme.textSecondary }}>
        Subtitle
      </p>
    </div>

    {/* Scrollable content */}
    <div
      className="px-6 md:px-8 py-6 space-y-5 max-h-[78vh] overflow-auto"
      style={{ backgroundColor: theme.bg }}
    >
      {/* Content */}
    </div>

    {/* Footer */}
    <div
      className="px-6 py-4 flex justify-end gap-3"
      style={{ borderTop: `1px solid ${theme.border}`, backgroundColor: theme.bgCard }}
    >
      <button
        className="px-4 py-2 text-sm font-bold uppercase tracking-wide transition-colors"
        style={{
          backgroundColor: 'transparent',
          color: theme.textSecondary,
          border: `1px solid ${theme.border}`,
        }}
        onClick={onClose}
      >
        Close
      </button>
      <button
        className="px-4 py-2 text-sm font-bold uppercase tracking-wide transition-colors"
        style={{ backgroundColor: theme.accent, color: theme.textOnAccent }}
      >
        Confirm
      </button>
    </div>
  </div>
</div>
```

**Key characteristics:**
- Overlay: `bg-black bg-opacity-50` (50% dark) — most modals use 50; one exception (SalesStaffLinkagesModal) uses 40; ImagePreview uses 75
- Modal: `max-w-6xl` with `mx-4` side margins
- Header: `4px` accent bottom border
- Body: page background color (`theme.bg`), max height `78vh`, scrollable
- Footer: separated by `1px` top border

---

## 17. Loading & Empty States

### Full-Page Loading Spinner

```jsx
<div className="flex justify-center items-center h-[50vh]">
  <FaSpinner className="w-10 h-10 animate-spin" style={{ color: theme.accent }} />
</div>
```

### Inline Loading Spinner

```jsx
<FaSpinner className="animate-spin h-5 w-5" style={{ color: theme.accent }} />
```

### Button Loading State

```jsx
<button disabled={isLoading}>
  {isLoading && <ImSpinner8 className="animate-spin mr-2 h-6 w-6" />}
  Submit
</button>
```

### Empty State

```jsx
<div className="flex flex-col justify-center items-center h-[50vh]">
  <p
    className="text-sm md:text-base uppercase tracking-wide"
    style={{ color: theme.textMuted }}
  >
    No items found
  </p>
</div>
```

---

## 18. Alerts & Errors

### Error Alert

```jsx
<div
  className="py-4 px-5 text-base text-center font-bold"
  style={{
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    color: '#ef4444',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  }}
>
  Error message here
</div>
```

### Success Alert

```jsx
<div
  className="mb-3 p-3 flex items-start gap-2"
  style={{
    backgroundColor: 'rgba(5, 150, 105, 0.08)',
    border: '1px solid #A7F3D0',
  }}
>
  <CheckCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: theme.accent }} />
  <div>
    <h3
      className="font-bold text-sm uppercase tracking-wide mb-0.5"
      style={{ color: '#047857' }}
    >
      Success
    </h3>
    <p className="text-sm" style={{ color: '#047857' }}>
      Operation completed successfully.
    </p>
  </div>
</div>
```

### Warning Alert

```jsx
<div
  className="flex items-center gap-2 px-3 py-2"
  style={{ backgroundColor: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}
>
  Warning message
</div>
```

### Toast Configuration

```jsx
import { ToastContainer } from 'react-toastify';

<ToastContainer position="top-right" autoClose={3000} />
```

---

## 19. Navigation & Back Buttons

### NavBar (Fixed Top)

```jsx
<nav className="fixed top-0 left-0 right-0 bg-white shadow-md z-50">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex justify-between h-16">
      {/* Logo */}
      <img src="/ads-logo-cutout.png" className="h-10 w-auto" alt="Logo" />

      {/* Mobile hamburger */}
      <button className="text-gray-700">
        <FiMenu size={24} /> {/* or FiX when open */}
      </button>
    </div>
  </div>
</nav>
```

### Back Button

```jsx
<button
  onClick={() => navigate(-1)}
  className="mb-6 inline-flex items-center font-semibold transition-colors"
  style={{ color: theme.accent }}
  onMouseEnter={(e) => { e.currentTarget.style.color = theme.accentHover; }}
  onMouseLeave={(e) => { e.currentTarget.style.color = theme.accent; }}
>
  <FaArrowLeft className="mr-2" />
  Go Back
</button>
```

---

## 20. Animations & Transitions

### CSS Transitions (On Every Interactive Element)

```jsx
className="transition-colors"  // Smooth color changes on hover/focus
```

### Tailwind Animations

| Class            | Effect                  | Duration |
|------------------|------------------------|----------|
| `animate-spin`   | Continuous rotation     | Infinite |
| `animate-pulse`  | Opacity pulsing         | Infinite |
| `animate-ping`   | Expanding ring          | Infinite |
| `animate-fade-in`| Fade up from below      | 0.5s     |
| `animate-slide-up`| Slide up from 20px     | 0.4s     |
| `animate-scale-in`| Scale from 95% to 100% | 0.3s     |

### Collapsible Panel Animation

```jsx
<div className={`transition-all duration-300 ${
  isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
}`}>
  {/* Content */}
</div>
```

### Progress Bar Animation

```jsx
<div className="h-2 overflow-hidden" style={{ backgroundColor: theme.progressBg }}>
  <div
    className="h-full transition-all duration-500 ease-out"
    style={{
      width: `${percentage}%`,
      backgroundColor: theme.accent,
    }}
  />
</div>
```

---

## 21. Responsive Design Rules

### Breakpoints (Tailwind Defaults)

| Prefix | Min Width | Typical Device      |
|--------|-----------|---------------------|
| (none) | 0px       | Mobile portrait     |
| `sm:`  | 640px     | Mobile landscape    |
| `md:`  | 768px     | Tablet              |
| `lg:`  | 1024px    | Desktop             |
| `xl:`  | 1280px    | Large desktop       |
| `2xl:` | 1536px    | Extra-large desktop |

### Common Responsive Patterns

**Font scaling:**
```
text-2xl sm:text-3xl md:text-4xl    // Page titles
text-sm md:text-base                // Body text
text-xs md:text-sm                  // Small text
text-[9px] md:text-[10px]          // Badge text
```

**Layout direction:**
```
flex flex-col sm:flex-row           // Stack → row
flex flex-col lg:flex-row           // Stack → row (later breakpoint)
grid grid-cols-1 sm:grid-cols-3    // 1 col → 3 cols
grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6  // Progressive grid
```

**Visibility:**
```
hidden sm:block                     // Hidden on mobile
hidden sm:inline                    // Hidden on mobile (inline)
```

**Padding progression:**
```
px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96
```

---

## 22. Icons

### Libraries Used

| Library                        | Import Pattern                | Primary Use              |
|-------------------------------|-------------------------------|--------------------------|
| `react-icons/fa`              | `import { FaIcon } from 'react-icons/fa'` | General icons           |
| `react-icons/fi`              | `import { FiIcon } from 'react-icons/fi'` | Navigation (Feather)    |
| `react-icons/ci`              | `import { CiIcon } from 'react-icons/ci'` | Edit/Search             |
| `react-icons/rx`              | `import { RxIcon } from 'react-icons/rx'` | Carets/chevrons         |
| `react-icons/im`              | `import { ImSpinner8 } from 'react-icons/im'` | Loading spinner     |
| `@heroicons/react/24/outline` | `import { Icon } from '@heroicons/react/24/outline'` | UI icons     |

### Most Used Icons

| Icon                    | Library       | Usage                    |
|-------------------------|---------------|--------------------------|
| `FaSpinner`             | `fa`          | Loading states           |
| `FaArrowLeft`           | `fa`          | Back navigation          |
| `FaPlus`                | `fa`          | Add actions              |
| `FaTrash`               | `fa`          | Delete actions           |
| `FaTimes`               | `fa`          | Close/dismiss            |
| `FaCheck`               | `fa`          | Confirm/success          |
| `FaPhoneAlt`            | `fa`          | Phone contact            |
| `FaWhatsapp`            | `fa`          | WhatsApp share           |
| `FiHome`                | `fi`          | Home navigation          |
| `FiMenu` / `FiX`       | `fi`          | Hamburger menu           |
| `CiEdit`                | `ci`          | Edit action              |
| `ImSpinner8`            | `im`          | Button loading           |
| `RxCaretDown/Up`        | `rx`          | Expand/collapse          |
| `XMarkIcon`             | `heroicons`   | Close modals             |
| `CheckCircleIcon`       | `heroicons`   | Success indicator        |
| `ExclamationTriangleIcon` | `heroicons` | Warning indicator        |
| `PencilSquareIcon`      | `heroicons`   | Edit action              |
| `TrashIcon`             | `heroicons`   | Delete action            |
| `ChevronDownIcon`       | `heroicons`   | Expand sections          |
| `MagnifyingGlassIcon`   | `heroicons`   | Search                   |

### Icon Sizing Conventions

```
h-3.5 w-3.5   // Small (14px) - inline with small text
h-4 w-4       // Default (16px) - inline with body text
h-5 w-5       // Medium (20px) - inline with inputs
h-6 w-6       // Large (24px) - standalone buttons
h-10 w-10     // XL (40px) - full-page spinner
```

---

## 23. Progress Bars

```jsx
<div className="space-y-3">
  {data.map((item) => (
    <div key={item.label}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm" style={{ color: theme.textSecondary }}>
          {item.label}
        </span>
        <span className="font-bold font-mono" style={{ color: theme.textPrimary }}>
          {item.count}
        </span>
      </div>
      <div className="h-2 overflow-hidden" style={{ backgroundColor: theme.progressBg }}>
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${(item.count / maxCount) * 100}%`,
            backgroundColor: theme.accent,
          }}
        />
      </div>
    </div>
  ))}
</div>
```

---

## 24. Collapsible Sections

### Expandable Section Header

```jsx
<button
  className="w-full flex items-center justify-between text-left font-bold text-sm uppercase tracking-wide py-2"
  style={{ color: theme.textPrimary }}
  onClick={() => setIsOpen(!isOpen)}
>
  <span>{`Section Title (${count})`}</span>
  {isOpen
    ? <RxCaretUp size={20} style={{ color: theme.accent }} />
    : <RxCaretDown size={20} style={{ color: theme.accent }} />
  }
</button>
```

### Full-Width Collapsible Panel

```jsx
<div style={{ backgroundColor: theme.bgCard, border: `1px solid ${theme.border}` }}>
  {/* Toggle header - accent background */}
  <button
    onClick={() => setIsOpen(!isOpen)}
    className="w-full flex justify-between items-center p-4 md:p-5 transition-colors focus:outline-none"
    style={{ backgroundColor: theme.accent, color: theme.textOnAccent }}
    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.accentHover)}
    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.accent)}
  >
    <div className="flex items-center gap-3">
      <div className="text-left">
        <h2 className="text-base md:text-lg font-bold uppercase tracking-wide">
          SECTION TITLE
        </h2>
        <p className="text-sm opacity-80">Subtitle</p>
      </div>
    </div>
    <ChevronDownIcon className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
  </button>

  {/* Collapsible content */}
  <div className={`transition-all duration-300 ${
    isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
  }`}>
    <div className="p-4 md:p-6" style={{ backgroundColor: theme.bgCardAlt }}>
      {/* Content */}
    </div>
  </div>
</div>
```

---

## 25. Reusable Component Reference

### Components to Build for Your Target App

| Component             | What It Does                                              |
|-----------------------|-----------------------------------------------------------|
| `Panel`               | Card with accent header border, title, subtitle, children |
| `KpiCard`             | Metric display with label, large mono number, pulse option |
| `LedgerInput`         | Text input with focus border color change                 |
| `LedgerSelect`        | Select dropdown matching input style                       |
| `PrimaryButton`       | Full-width accent button with loading state               |
| `SecondaryButton`     | Border button with light background                       |
| `DangerButton`        | Red toggle button (active/inactive states)                |
| `Badge`               | Small uppercase pill for status/designation               |
| `CountBadge`          | Mono number on accent-tinted background                   |
| `BackButton`          | Arrow + text, accent colored                              |
| `PageWrapper`         | Full-bleed bg + responsive content container              |
| `PageHeader`          | Title + subtitle + 4px accent border                      |
| `ListContainer`       | Card with section header + hoverable rows                 |
| `Modal`               | Overlay + container + header + scrollable body + footer   |
| `ErrorAlert`          | Red-tinted box for error messages                         |
| `SuccessAlert`        | Green-tinted box with icon                                |
| `LoadingSpinner`      | Centered spinner at 50vh                                  |
| `EmptyState`          | Centered muted uppercase message at 50vh                  |
| `ProgressBar`         | Label + count + emerald bar on track                      |
| `CollapsibleSection`  | Toggle header with animated content area                  |

---

## 26. Full Page Examples

### Example: Dashboard Page Structure

```jsx
import { FaSpinner } from 'react-icons/fa';

const theme = { /* ... full theme object ... */ };

const DashboardPage = () => {
  return (
    <div
      className="min-h-screen pt-[4rem]"
      style={{
        backgroundColor: theme.bg,
        width: '100vw',
        marginLeft: 'calc(-50vw + 50%)',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div className="w-full px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">

        {/* Page Header */}
        <header
          className="mb-6 md:mb-8 pb-4"
          style={{ borderBottom: `4px solid ${theme.borderAccent}` }}
        >
          <h1 className="text-2xl md:text-3xl font-bold uppercase tracking-wide"
              style={{ color: theme.textPrimary }}>
            Dashboard
          </h1>
          <p className="text-sm md:text-base mt-1" style={{ color: theme.textSecondary }}>
            Analytics and insights
          </p>
        </header>

        {/* KPI Grid */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 mb-6 md:mb-8">
          <KpiCard label="Users" value={1234} />
          <KpiCard label="Revenue" value={56789} />
          <KpiCard label="Active Now" value={42} pulse />
        </section>

        {/* Two-Column Panel Grid */}
        <div className="grid gap-4 md:gap-6 md:grid-cols-2 mb-6 md:mb-8">
          <Panel title="Recent Activity" subtitle="Last 7 days">
            {/* Table or content */}
          </Panel>
          <Panel title="Distribution" subtitle="By category">
            {/* Progress bars */}
          </Panel>
        </div>
      </div>
    </div>
  );
};
```

### Example: List Page Structure

```jsx
const ListPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState([]);

  return (
    <div
      className="min-h-screen pt-[4rem]"
      style={{
        backgroundColor: theme.bg,
        width: '100vw',
        marginLeft: 'calc(-50vw + 50%)',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div className="w-full px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">

        {/* Header */}
        <header
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8 pb-4 md:pb-6"
          style={{ borderBottom: `4px solid ${theme.borderAccent}` }}
        >
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold uppercase tracking-tight"
                style={{ color: theme.textPrimary }}>
              Items
            </h1>
            <p className="mt-2 text-sm md:text-base" style={{ color: theme.textSecondary }}>
              Manage your items
            </p>
          </div>
        </header>

        {/* Search + Actions */}
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-md px-3 md:px-4 py-2 focus:outline-none transition-colors text-sm md:text-base"
          style={{
            backgroundColor: theme.bgInput,
            border: `2px solid ${theme.border}`,
            color: theme.textPrimary,
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = theme.accent)}
          onBlur={(e) => (e.currentTarget.style.borderColor = theme.border)}
        />

        {/* Content */}
        {isLoading ? (
          <div className="flex justify-center items-center h-[50vh]">
            <FaSpinner className="w-10 h-10 animate-spin" style={{ color: theme.accent }} />
          </div>
        ) : items.length > 0 ? (
          <div
            className="mt-6 md:mt-8 overflow-hidden"
            style={{ backgroundColor: theme.bgCard, border: `1px solid ${theme.border}` }}
          >
            <div
              className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between"
              style={{ borderBottom: `2px solid ${theme.borderAccent}` }}
            >
              <h2 className="font-bold uppercase tracking-wide text-sm md:text-base"
                  style={{ color: theme.textPrimary }}>
                All Items
              </h2>
              <span className="text-xs md:text-sm" style={{ color: theme.textMuted }}>
                {items.length} items
              </span>
            </div>

            {items.map((item, index) => (
              <div
                key={item.id}
                className="px-4 md:px-6 py-4 md:py-5 flex flex-col lg:flex-row lg:items-center gap-3 md:gap-4 transition-colors"
                style={{ borderBottom: `1px solid ${theme.border}`, cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.hoverBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 md:gap-3">
                    <span className="font-bold" style={{ color: theme.accent }}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="font-bold text-base md:text-lg" style={{ color: theme.textPrimary }}>
                      {item.name}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col justify-center items-center h-[50vh]">
            <p className="text-sm md:text-base uppercase tracking-wide"
               style={{ color: theme.textMuted }}>
              No items found
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
```

### Example: Detail/Form Page Structure

```jsx
const DetailPage = () => {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className="min-h-screen pt-[4rem]"
      style={{
        backgroundColor: theme.bg,
        width: '100vw',
        marginLeft: 'calc(-50vw + 50%)',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div className="w-full px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex items-center font-semibold transition-colors"
          style={{ color: theme.accent }}
          onMouseEnter={(e) => { e.currentTarget.style.color = theme.accentHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = theme.accent; }}
        >
          <FaArrowLeft className="mr-2" />
          Go Back
        </button>

        {/* Detail card */}
        <div style={{ backgroundColor: theme.bgCard, border: `1px solid ${theme.border}` }}>

          {/* Card header */}
          <div
            className="px-4 md:px-6 py-3 md:py-4"
            style={{ borderBottom: `4px solid ${theme.borderAccent}` }}
          >
            <h1 className="text-xl md:text-2xl font-bold uppercase tracking-tight"
                style={{ color: theme.textPrimary }}>
              Item Details
            </h1>
          </div>

          {/* Form fields */}
          <div className="px-4 md:px-6">
            {/* Field row */}
            <div className="py-4 flex flex-col" style={{ borderBottom: `1px solid ${theme.border}` }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-2"
                   style={{ color: theme.textMuted }}>
                Name <span className="text-red-500 ml-1">*</span>
              </div>
              {isEditing ? (
                <input
                  className="w-full px-3 py-2 text-sm md:text-base focus:outline-none transition-colors"
                  style={{
                    backgroundColor: theme.bgInput,
                    border: `2px solid ${theme.border}`,
                    color: theme.textPrimary,
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = theme.accent)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = theme.border)}
                />
              ) : (
                <span className="text-sm md:text-base font-semibold"
                      style={{ color: theme.textPrimary }}>
                  Display Value
                </span>
              )}
            </div>

            {/* More field rows... */}
          </div>

          {/* Action footer */}
          <div
            className="px-4 md:px-6 py-4 flex justify-end gap-3"
            style={{ borderTop: `1px solid ${theme.border}`, backgroundColor: theme.bgCardAlt }}
          >
            <button
              className="px-4 py-2 text-sm font-bold uppercase tracking-wide transition-colors"
              style={{ backgroundColor: theme.accent, color: theme.textOnAccent }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
```

---

## Quick Reference Cheat Sheet

### The 5 Rules of Ledger UI

1. **Sharp corners on data pages.** Cards, panels, inputs, and buttons on Ledger UI pages use zero border-radius. Peripheral components (NavBar, FileUpload, RegisterPage, entity cards) do use rounding.
2. **Border hierarchy:** `4px` page header > `2px` section header / inputs > `1px` dividers / cards.
3. **All text labels are uppercase** with `tracking-wide` or `tracking-wider`.
4. **Numbers are always `font-mono`** and often displayed in accent-colored badges.
5. **Hover = `transition-colors`** + background shift to `hoverBg` or border shift to `accent`.

### The Theme in 30 Seconds

```
Background:  #F0F7F4  (soft green-white page bg)
Cards:       #FFFFFF  (pure white)
Accent:      #059669  (emerald green — THE brand color)
Borders:     #D1E7DD  (soft green — card/section borders)
Text Dark:   #2A2A2A  (primary text)
Text Mid:    #6B6560  (secondary text)
Text Light:  #9A948D  (muted labels)
Hover:       #E6F2EC  (light green hover state)
Danger:      #ef4444  (red for delete/error)
```

### NPM Dependencies to Install

```bash
npm install react-icons @heroicons/react react-toastify tailwindcss postcss autoprefixer
```

**Also add Inter font** (not loaded in original codebase, but referenced everywhere):
```html
<!-- In index.html <head> -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

---

*Generated from the ADS Agrotech codebase. Use this guide as a reference to systematically adopt the Ledger UI (Emerald Light Mode) design system in your target React application.*
