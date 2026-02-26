/**
 * Ledger UI theme tokens for dynamic inline styles.
 *
 * Use ONLY where CSS variables cannot work (e.g., style={{ width: `${percent}%` }}).
 * For color references in JSX, use Tailwind utility classes (bg-accent, text-text-primary, etc.).
 */
export const theme = {
  accent: "#059669",
  accentHover: "#047857",
  bg: "#F0F7F4",
  bgCard: "#FFFFFF",
  bgCardAlt: "#F5FAF7",
  bgInput: "#FFFFFF",
  hoverBg: "#E6F2EC",
  border: "#D1E7DD",
  borderAccent: "#059669",
  textPrimary: "#2A2A2A",
  textSecondary: "#6B6560",
  textMuted: "#9A948D",
  textOnAccent: "#FFFFFF",
  danger: "#ef4444",
  dangerBg: "rgba(239, 68, 68, 0.08)",
  successBg: "rgba(5, 150, 105, 0.08)",
  warningBg: "#fef3c7",
  warningBorder: "#fcd34d",
  warningText: "#92400e",
} as const;
