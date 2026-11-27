// The text of an AI Summary (Test Insight, #564): the Markdown AI Mentorship
// Guide wrote, rendered with react-markdown and remark-gfm (the plugin the
// generator's own report view uses, for its tables). Raw HTML in the text is
// never rendered (`skipHtml`), images are dropped and only web links are
// links, opening in a new tab.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="text-lg font-bold">{children}</h3>,
  h2: ({ children }) => <h4 className="text-base font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="font-semibold">{children}</h5>,
  h4: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-text-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-border bg-bg px-3 py-2 font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-border px-3 py-2 align-top">
      {children}
    </td>
  ),
  img: () => null,
  a: ({ href, children }) =>
    href && /^https?:\/\//i.test(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      <>{children}</>
    ),
};

export default function TestInsightText({ markdown }: { markdown: string }) {
  return (
    <article
      aria-label="AI Summary text"
      className="space-y-3 break-words text-sm leading-6 text-text-primary"
    >
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
