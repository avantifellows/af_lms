import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { RecordingUpload } from "./RecordingUpload";

const UPLOAD_URL = "https://test-bucket.s3.ap-south-1.amazonaws.com/lms-documents/blended-learning/recordings/501/k.mp3?X-Amz-Expires=900";
const S3_KEY = "lms-documents/blended-learning/recordings/501/3f2b8c1e-7d4a-4c9b-8e21-5a6f0d9c1b2e.mp3";
const SESSION = { occurredOn: "2026-10-21", mode: "call", spokeWith: "both", durationMinutes: 35 } as const;

// The browser's PUT to S3: each upload is one fake XHR the test drives.
class FakeXhr {
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {}
  progress(loaded: number, total: number) {
    act(() => this.upload.onprogress?.({ lengthComputable: true, loaded, total }));
  }
  succeed() {
    this.status = 200;
    act(() => this.onload?.());
  }
  fail() {
    act(() => this.onerror?.());
  }
}

// The LMS API routes: answer by path, and record what was sent.
const mockFetch = vi.fn();
let sent: { url: string; body: unknown }[];

function givenApi(draftStatus = 201, draftBody: unknown = { draftId: 41, delivery: "skipped" }) {
  sent = [];
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url, body });
    if (url.endsWith("/recordings/upload-url")) {
      return new Response(JSON.stringify({ uploadUrl: UPLOAD_URL, s3Key: S3_KEY, contentType: "audio/mpeg" }), { status: 200 });
    }
    if (url.endsWith("/drafts")) return new Response(JSON.stringify(draftBody), { status: draftStatus });
    return new Response("{}", { status: 404 });
  });
}

function recording(name = "call with Ira.mp3", type = "audio/mpeg", size = 4096) {
  return new File([new Uint8Array(size)], name, { type });
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText("Upload the recording"), { target: { files: [file] } });
}

async function lastXhr(count: number) {
  await waitFor(() => expect(FakeXhr.instances).toHaveLength(count));
  return FakeXhr.instances[count - 1];
}

beforeEach(() => {
  FakeXhr.instances = [];
  mockRefresh.mockReset();
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  givenApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecordingUpload", () => {
  it("offers any audio file from the phone in a drop zone", () => {
    render(<RecordingUpload studentId={501} sessionDetails={SESSION} />);
    expect(screen.getByLabelText("Upload the recording")).toHaveAttribute("accept", "audio/*");
    expect(screen.getByText("Upload the recording")).toBeInTheDocument();
    expect(screen.getByText(/^MP3, M4A or WAV, up to 200 MB\. We write out the notes/)).toBeInTheDocument();
    expect(screen.getByText("The session details above are saved with the draft.")).toBeInTheDocument();
  });

  it("PUTs the recording straight to S3 with progress, creates the draft with the session details and refreshes the log page", async () => {
    render(<RecordingUpload studentId={501} sessionDetails={SESSION} />);
    const file = recording();
    pick(file);

    const xhr = await lastXhr(1);
    expect(sent[0]).toEqual({
      url: "/api/blended-learning/students/501/recordings/upload-url",
      body: { fileName: "call with Ira.mp3", contentType: "audio/mpeg", byteSize: 4096 },
    });
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(UPLOAD_URL);
    expect(xhr.headers).toEqual({ "Content-Type": "audio/mpeg" });
    expect(xhr.body).toBe(file);

    // The picked file's row replaces the drop zone, with its status.
    expect(screen.getByText("call with Ira.mp3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload the recording")).not.toBeInTheDocument();
    xhr.progress(1638, 4096);
    expect(screen.getByRole("status")).toHaveTextContent("Uploading… 40%");
    expect(screen.getByRole("progressbar", { name: "Upload progress" })).toHaveAttribute("value", "40");

    xhr.succeed();
    expect(await screen.findByText("Recording uploaded. Starting the draft…")).toBeInTheDocument();
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(sent[1]).toEqual({
      url: "/api/blended-learning/students/501/drafts",
      body: { s3Key: S3_KEY, contentType: "audio/mpeg", byteSize: 4096, ...SESSION },
    });
  });

  it("recovers from a failed PUT with Retry", async () => {
    const user = userEvent.setup();
    render(<RecordingUpload studentId={501} sessionDetails={SESSION} />);
    pick(recording());

    (await lastXhr(1)).fail();
    expect(await screen.findByRole("alert")).toHaveTextContent("The upload didn't finish. Check your connection and retry.");
    expect(screen.getByText("Choose another recording")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Retry upload" }));
    const retry = await lastXhr(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    retry.succeed();

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    // One draft, created only after the successful PUT.
    expect(sent.filter((call) => call.url.endsWith("/drafts"))).toHaveLength(1);
  });

  it("retries only the draft step when the PUT finished but the draft wasn't created", async () => {
    const user = userEvent.setup();
    givenApi(502, { error: "Bad gateway" });
    render(<RecordingUpload studentId={501} sessionDetails={SESSION} />);
    pick(recording());
    (await lastXhr(1)).succeed();
    expect(await screen.findByRole("alert")).toHaveTextContent("Bad gateway");

    givenApi();
    await user.click(screen.getByRole("button", { name: "Retry upload" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(FakeXhr.instances).toHaveLength(1);
    expect(sent.map((call) => call.url)).toEqual(["/api/blended-learning/students/501/drafts"]);
  });

  it("shows the server's reason when the upload is refused", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "This Mentee already has a Conversation Draft." }), { status: 409 })
    );
    render(<RecordingUpload studentId={501} sessionDetails={SESSION} />);
    pick(recording());

    expect(await screen.findByRole("alert")).toHaveTextContent("This Mentee already has a Conversation Draft.");
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("checks the file type and size before uploading", async () => {
    render(<RecordingUpload studentId={501} sessionDetails={SESSION} />);
    pick(recording("notes.pdf", "application/pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose an MP3, M4A or WAV recording.");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
