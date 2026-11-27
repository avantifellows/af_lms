import ReactMarkdown, { type Components } from "react-markdown";

import { SAFE_MARKDOWN_COMPONENTS } from "@/components/safe-markdown-components";

const COMPONENTS: Components = {
  h1: ({ children }) => <h2 className="text-lg font-semibold">{children}</h2>,
  h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold">{children}</h4>,
  ...SAFE_MARKDOWN_COMPONENTS,
};

export default function GuidancePreview({ markdown }: { markdown: string }) {
  if (!markdown.trim()) return <p className="text-sm text-text-muted">No Guidance yet.</p>;
  return (
    <div className="space-y-2 break-words text-sm leading-6 text-text-primary">
      <ReactMarkdown skipHtml components={COMPONENTS}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
