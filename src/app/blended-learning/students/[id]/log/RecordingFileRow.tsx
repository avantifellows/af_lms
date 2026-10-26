import { FileAudio } from "lucide-react";

import { StatusPill } from "./formParts";

// A Call Recording as one row, as in the mockup: its name and a status pill.
export function RecordingFileRow({ name, tone, status }: { name: string; tone: "busy" | "done"; status: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg px-4 py-3">
      <FileAudio aria-hidden="true" className="h-5 w-5 shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 basis-40 break-words font-bold text-text-primary">{name}</span>
      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  );
}
