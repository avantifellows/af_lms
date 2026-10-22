"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui";

import { RecordingFileRow } from "./RecordingFileRow";

// Upload a Call Recording instead of typing the write-up: a dashed drop zone
// as in the mockup, then a file row with the upload's status. The browser asks
// for a presigned PUT, sends the file straight to S3 (XHR, for progress), then
// creates the Conversation Draft with any session details already entered and
// refreshes the log page, which then shows the draft's progress in place and
// opens it prefilled once etl-next has drafted it.

const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
const RECORDING_EXTENSION = /\.(mp3|m4a|wav)$/i;

type SessionDetails = {
  occurredOn: string | null;
  mode: string | null;
  spokeWith: string | null;
  durationMinutes: number | null;
};

type Uploaded = { s3Key: string; contentType: string; byteSize: number };
type UploadState =
  | { status: "idle" }
  | { status: "uploading"; percent: number }
  | { status: "drafting" }
  | { status: "failed"; error: string; file: File | null; uploaded: Uploaded | null }
  | { status: "done" };

class RefusedError extends Error {
  // A refusal the same request would get again (no access, open draft…).
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RefusedError(
      typeof json.error === "string" ? json.error : "Couldn't upload the recording. Try again.",
      [403, 404, 409].includes(res.status)
    );
  }
  return json;
}

function putToS3(url: string, file: File, contentType: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status))));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

// Why the browser won't upload this file, or null when it can.
function recordingProblem(file: File): string | null {
  if (!RECORDING_EXTENSION.test(file.name)) return "Choose an MP3, M4A or WAV recording.";
  if (file.size < 1 || file.size > MAX_RECORDING_BYTES) return "A recording must be 200 MB or smaller.";
  return null;
}

// The dashed area that opens the file picker; the whole area is the target.
function RecordingDropZone({ retrying, onPick }: { retrying: boolean; onPick: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const inputId = useId();
  return (
    <label
      htmlFor={inputId}
      className="flex min-h-11 w-full cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-border bg-bg px-4 py-4 transition-colors hover:border-accent focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:px-5"
    >
      <Upload aria-hidden="true" className="h-7 w-7 shrink-0 text-accent" />
      <span className="min-w-0">
        <span className="block text-base font-bold text-text-primary">
          {retrying ? "Choose another recording" : "Upload the recording"}
        </span>
        <span className="block text-sm text-text-secondary">
          MP3, M4A or WAV, up to 200 MB. We write out the notes and draft the summary and action items for you to edit.
        </span>
      </span>
      <input
        id={inputId}
        type="file"
        accept="audio/*"
        aria-label="Upload the recording"
        onChange={onPick}
        className="sr-only"
      />
    </label>
  );
}

// The picked file while it uploads and the draft starts.
function UploadProgress({ fileName, upload }: { fileName: string; upload: UploadState }) {
  if (upload.status === "uploading") {
    return (
      <div className="space-y-2">
        <RecordingFileRow name={fileName} tone="busy" status={`Uploading… ${upload.percent}%`} />
        <progress aria-label="Upload progress" value={upload.percent} max={100} className="h-2 w-full accent-accent" />
      </div>
    );
  }
  return <RecordingFileRow name={fileName} tone="busy" status="Recording uploaded. Starting the draft…" />;
}

function UploadFailure({ error, canRetry, onRetry }: { error: string; canRetry: boolean; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
        {error}
      </p>
      {canRetry && (
        <Button type="button" onClick={onRetry} className="w-full sm:w-auto">
          Retry upload
        </Button>
      )}
    </div>
  );
}

export function RecordingUpload({ studentId, sessionDetails }: { studentId: number; sessionDetails: SessionDetails }) {
  const router = useRouter();
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });
  const [fileName, setFileName] = useState("");

  async function createDraft(uploaded: Uploaded) {
    setUpload({ status: "drafting" });
    try {
      await postJson(`/api/blended-learning/students/${studentId}/drafts`, { ...uploaded, ...sessionDetails });
    } catch (error) {
      const refused = error instanceof RefusedError ? error : null;
      setUpload({
        status: "failed",
        error: refused?.message ?? "Couldn't reach the server. Check your connection and retry.",
        file: null,
        uploaded: refused?.permanent ? null : uploaded,
      });
      return;
    }
    setUpload({ status: "done" });
    router.refresh();
  }

  async function start(file: File) {
    const problem = recordingProblem(file);
    if (problem) {
      setUpload({ status: "failed", error: problem, file: null, uploaded: null });
      return;
    }
    setFileName(file.name);
    setUpload({ status: "uploading", percent: 0 });
    let uploaded: Uploaded;
    try {
      const issued = await postJson(`/api/blended-learning/students/${studentId}/recordings/upload-url`, {
        fileName: file.name,
        contentType: file.type,
        byteSize: file.size,
      });
      const contentType = String(issued.contentType);
      await putToS3(String(issued.uploadUrl), file, contentType, (percent) =>
        setUpload({ status: "uploading", percent })
      );
      uploaded = { s3Key: String(issued.s3Key), contentType, byteSize: file.size };
    } catch (error) {
      const refused = error instanceof RefusedError ? error : null;
      setUpload({
        status: "failed",
        error: refused?.message ?? "The upload didn't finish. Check your connection and retry.",
        file: refused?.permanent ? null : file,
        uploaded: null,
      });
      return;
    }
    await createDraft(uploaded);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void start(file);
  }

  function retry() {
    if (upload.status !== "failed") return;
    if (upload.uploaded) void createDraft(upload.uploaded);
    else if (upload.file) void start(upload.file);
  }

  if (upload.status !== "idle" && upload.status !== "failed") {
    return <UploadProgress fileName={fileName} upload={upload} />;
  }
  const failed = upload.status === "failed";
  return (
    <div className="space-y-2">
      {failed && (
        <UploadFailure error={upload.error} canRetry={upload.uploaded !== null || upload.file !== null} onRetry={retry} />
      )}
      <RecordingDropZone retrying={failed} onPick={onPick} />
      <p className="text-sm text-text-secondary">The session details above are saved with the draft.</p>
    </div>
  );
}
