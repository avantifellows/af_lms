// The text of an AI Summary (Test Insight, #564): the Markdown AI Mentorship
// Guide wrote, rendered with react-markdown and remark-gfm (the plugin the
// generator's own report view uses, for its tables). Raw HTML in the text is
// never rendered (`skipHtml`), images are dropped and only web links are
// links, opening in a new tab.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { SAFE_MARKDOWN_COMPONENTS } from "@/components/safe-markdown-components";

const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="text-lg font-bold">{children}</h3>,
  h2: ({ children }) => <h4 className="text-base font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="font-semibold">{children}</h5>,
  h4: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  ...SAFE_MARKDOWN_COMPONENTS,
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
