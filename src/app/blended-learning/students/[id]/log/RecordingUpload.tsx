"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui";

// Upload a Call Recording instead of typing the write-up. The browser asks
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

export function RecordingUpload({ studentId, sessionDetails }: { studentId: number; sessionDetails: SessionDetails }) {
  const router = useRouter();
  const inputId = useId();
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });
  const busy = upload.status === "uploading" || upload.status === "drafting" || upload.status === "done";

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

  const canRetry = upload.status === "failed" && (upload.uploaded !== null || upload.file !== null);

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
        Call Recording (optional)
      </legend>
      <p className="text-xs text-text-secondary">
        Upload the call instead of typing the write-up. The date, mode, who you spoke with and duration above are saved
        with the draft.
      </p>
      <p className="text-xs text-text-secondary">MP3, M4A or WAV, up to 200 MB.</p>
      {upload.status === "uploading" && (
        <div className="space-y-1">
          <progress aria-label="Upload progress" value={upload.percent} max={100} className="h-2 w-full accent-accent" />
          <p className="text-sm text-text-secondary">{`Uploading… ${upload.percent}%`}</p>
        </div>
      )}
      {(upload.status === "drafting" || upload.status === "done") && (
        <p className="text-sm text-text-secondary">Recording uploaded. Starting the draft…</p>
      )}
      {upload.status === "failed" && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
          {upload.error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canRetry && (
          <Button type="button" onClick={retry} className="w-full sm:w-auto">
            Retry upload
          </Button>
        )}
        {!busy && (
          <label
            htmlFor={inputId}
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-card px-4 text-sm font-bold text-text-primary shadow-sm hover:bg-hover-bg focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:w-auto"
          >
            {upload.status === "failed" ? "Choose another recording" : "Upload a Call Recording"}
            <input
              id={inputId}
              type="file"
              accept="audio/*"
              aria-label="Upload a Call Recording"
              onChange={onPick}
              className="sr-only"
            />
          </label>
        )}
      </div>
    </fieldset>
  );
}
