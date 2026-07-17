import ReactMarkdown from "react-markdown";

export default function GuidancePreview({ markdown }: { markdown: string }) {
  if (!markdown.trim()) return <p className="text-sm text-text-muted">No Guidance yet.</p>;
  return (
    <div className="space-y-2 break-words text-sm leading-6 text-text-primary">
      <ReactMarkdown
        skipHtml
        components={{
          h1: ({ children }) => <h2 className="text-lg font-semibold">{children}</h2>,
          h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="font-semibold">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 text-text-secondary">{children}</blockquote>,
          hr: () => <hr className="border-border" />,
          img: () => null,
          a: ({ href, children }) => href && /^https?:\/\//i.test(href)
            ? <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent underline">{children}</a>
            : <>{children}</>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
