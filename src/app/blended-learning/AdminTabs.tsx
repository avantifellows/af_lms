import Link from "next/link";

// The Blended Learning Admin landing's tabs, as links so each tab has a URL.
export type AdminTab = "mentors" | "flags";

const TABS: { tab: AdminTab; label: string; href: string }[] = [
  { tab: "mentors", label: "Mentors", href: "/blended-learning" },
  { tab: "flags", label: "Flags", href: "/blended-learning?tab=flags" },
];

export function AdminTabs({ current }: { current: AdminTab }) {
  return (
    <nav aria-label="Admin views" className="flex gap-1 border-b border-border">
      {TABS.map(({ tab, label, href }) => {
        const active = tab === current;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex min-h-11 min-w-11 items-center justify-center border-b-2 px-4 text-sm font-bold ${
              active
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
