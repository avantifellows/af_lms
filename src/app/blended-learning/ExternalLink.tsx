import { ArrowUpRight, type LucideIcon } from "lucide-react";

// A link out of the app (a Profile doc, a Screener form, a Mentor resource):
// opens in a new tab, with its icon and a ↗.
export function ExternalLink({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${children} (opens in a new tab)`}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-primary underline underline-offset-4 hover:text-accent"
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {children}
      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}
