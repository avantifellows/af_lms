import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const links = /\[([^\]]+)]\(([^)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(links)) {
    const index = match.index ?? 0;
    parts.push(text.slice(cursor, index));
    const href = match[2].trim();
    parts.push(
      /^(https?:\/\/|\/|#)/i.test(href) ? (
        <a key={index} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="font-medium text-accent underline">
          {match[1]}
        </a>
      ) : <span key={index}>{match[1]}</span>
    );
    cursor = index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

export default function GuidancePreview({ markdown }: { markdown: string }) {
  if (!markdown.trim()) return <p className="text-sm text-text-muted">No Guidance yet.</p>;
  return (
    <div className="space-y-2 break-words text-sm leading-6 text-text-primary">
      {markdown.split("\n").map((line, index) => {
        if (line.startsWith("### ")) return <h4 key={index} className="font-semibold">{inline(line.slice(4))}</h4>;
        if (line.startsWith("## ")) return <h3 key={index} className="text-base font-semibold">{inline(line.slice(3))}</h3>;
        if (line.startsWith("# ")) return <h2 key={index} className="text-lg font-semibold">{inline(line.slice(2))}</h2>;
        if (/^[-*] /.test(line)) return <div key={index} className="pl-4 before:mr-2 before:content-['•']">{inline(line.slice(2))}</div>;
        return line ? <p key={index}>{inline(line)}</p> : <br key={index} />;
      })}
    </div>
  );
}
