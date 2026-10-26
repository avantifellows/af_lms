// A Chapter as the Plan editor and the chapter timeline show it: its code, small and muted, then
// its name. No hooks and no server-only imports, so client and server components share it.
export default function ChapterLabel({ code, name }: { code: string; name: string }) {
  return (
    <>
      {code ? (
        <>
          <span data-chapter-code className="font-mono text-xs text-text-muted">
            {code}
          </span>{" "}
        </>
      ) : null}
      <span className="font-bold text-text-primary">{name}</span>
    </>
  );
}
