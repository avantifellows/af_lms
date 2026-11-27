// The react-markdown element overrides shared by every place the LMS renders
// Markdown it did not write (Holistic Guidance, the AI Summary text): lists,
// quotes and rules styled for the app, images dropped, and only web links as
// links, opening in a new tab. Headings and tables are each caller's own.
// Use with `skipHtml`, so raw HTML in the text is never rendered.
import type { Components } from "react-markdown";

export const SAFE_MARKDOWN_COMPONENTS: Components = {
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-text-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="border-border" />,
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
