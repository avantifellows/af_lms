/**
 * Ledger UI theme tokens for dynamic inline styles.
 *
 * These MIRROR the Avanti Fellows brand tokens defined in `src/app/globals.css`
 * (the `--color-*` custom properties). Keep them in sync with that file — it is
 * the source of truth that Tailwind utility classes resolve against.
 *
 * Use ONLY where CSS variables cannot work (e.g., style={{ width: `${percent}%` }}).
 * For color references in JSX, use Tailwind utility classes (bg-accent, text-text-primary, etc.).
 */
export const theme = {
  accent: "#ad2f2f",
  accentHover: "#8a2525",
  bg: "#f5efe8",
  bgCard: "#fffaf5",
  bgCardAlt: "#f3ece5",
  bgInput: "#ffffff",
  hoverBg: "rgba(173, 47, 47, 0.06)",
  border: "rgba(38, 20, 16, 0.15)",
  borderAccent: "#ad2f2f",
  textPrimary: "#261410",
  textSecondary: "#685851",
  textMuted: "#685851",
  textOnAccent: "#FFFFFF",
  danger: "#ad2f2f",
  dangerBg: "rgba(173, 47, 47, 0.08)",
  success: "#1e6b4b",
  successBg: "rgba(30, 107, 75, 0.12)",
  warningBg: "rgba(140, 90, 29, 0.08)",
  warningBorder: "#8c5a1d",
  warningText: "#8c5a1d",
} as const;
