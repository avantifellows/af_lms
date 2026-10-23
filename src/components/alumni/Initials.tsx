// Round initials avatar ("Aishdeep Kaur" → "AK"), coloured by name so the same
// student always gets the same colour.
const COLOURS = [
  "bg-brand-coral-bg text-accent",
  "bg-brand-gold-bg text-warning-text",
  "bg-brand-blue-bg text-text-secondary",
  "bg-success-bg text-success",
  "bg-brand-amber-bg text-warning-text",
];

export default function Initials({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const dims = size === "lg" ? "h-12 w-12 text-base" : "h-9 w-9 text-xs";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold ${dims} ${COLOURS[hash % COLOURS.length]}`} aria-hidden>
      {letters}
    </span>
  );
}
