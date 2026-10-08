export function CopyLink({ label, href, onCopy }: { label: string; href: string; onCopy: (msg: string) => void }) {
  if (!href) return <span className="text-xs text-text-muted">{label}: -</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      onCopy(`${label} copied`);
    } catch {
      window.prompt(`Copy ${label}:`, href);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-accent hover:underline"
      >
        {label}
      </a>
      <button
        type="button"
        onClick={copy}
        className="text-text-muted hover:text-text-primary"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        ⧉
      </button>
    </span>
  );
}
