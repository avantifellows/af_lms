"use client";

import { useState } from "react";

type Load<T> = { status: "idle" | "loading" | "error" } | { status: "done"; value: T };
type Playback = { expired: true } | { expired: false; url: string };
type Transcript = { expired: true } | { expired: false; turns: { speaker: string | null; text: string }[] };

const BUTTON = "flex min-h-11 items-center text-sm font-bold text-accent hover:text-accent-hover";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

// A saved Conversation's Call Recording and transcript, for Blended Learning
// Admins only (ADR 0010); the page never renders this for a Mentor. Both load
// on demand: the recording as a 5-minute presigned GET, which S3's lifecycle
// rule may already have expired.
export function ConversationRecording({
  conversationId,
  hasRecording,
  hasTranscript,
}: {
  conversationId: number;
  hasRecording: boolean;
  hasTranscript: boolean;
}) {
  const [playback, setPlayback] = useState<Load<Playback>>({ status: "idle" });
  const [transcript, setTranscript] = useState<Load<Transcript>>({ status: "idle" });
  const [showTranscript, setShowTranscript] = useState(false);
  const base = `/api/blended-learning/conversations/${conversationId}`;

  async function play() {
    setPlayback({ status: "loading" });
    try {
      setPlayback({ status: "done", value: await fetchJson<Playback>(`${base}/recording`) });
    } catch {
      setPlayback({ status: "error" });
    }
  }

  async function toggleTranscript() {
    const next = !showTranscript;
    setShowTranscript(next);
    if (!next || transcript.status === "done" || transcript.status === "loading") return;
    setTranscript({ status: "loading" });
    try {
      setTranscript({ status: "done", value: await fetchJson<Transcript>(`${base}/transcript`) });
    } catch {
      setTranscript({ status: "error" });
    }
  }

  const panelId = `conversation-${conversationId}-transcript`;
  return (
    <section aria-label="Call Recording" className="space-y-1">
      {hasRecording &&
        (playback.status === "done" ? (
          playback.value.expired ? (
            <p className="text-sm text-text-muted">Recording expired</p>
          ) : (
            <audio controls autoPlay src={playback.value.url} className="w-full max-w-md">
              Your browser can&apos;t play this recording.
            </audio>
          )
        ) : (
          <>
            <button type="button" onClick={play} disabled={playback.status === "loading"} className={BUTTON}>
              {playback.status === "loading" ? "Loading recording…" : "Play recording"}
            </button>
            {playback.status === "error" && (
              <p className="text-sm text-danger">Couldn&apos;t load the recording. Try again.</p>
            )}
          </>
        ))}
      {hasTranscript && (
        <div>
          <button
            type="button"
            onClick={toggleTranscript}
            aria-expanded={showTranscript}
            aria-controls={panelId}
            className={BUTTON}
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript && (
            <div id={panelId} className="border-l-2 border-border pl-3">
              {transcript.status === "loading" && <p className="text-sm text-text-muted">Loading transcript…</p>}
              {transcript.status === "error" && (
                <p className="text-sm text-danger">Couldn&apos;t load the transcript. Try again.</p>
              )}
              {transcript.status === "done" &&
                (transcript.value.expired ? (
                  <p className="text-sm text-text-muted">Transcript expired</p>
                ) : (
                  <ol aria-label="Transcript" className="space-y-2">
                    {transcript.value.turns.map((turn, index) => (
                      <li key={index} className="break-words text-sm text-text-primary">
                        {turn.speaker && <span className="block text-xs font-bold text-text-secondary">{turn.speaker}</span>}
                        {turn.text}
                      </li>
                    ))}
                  </ol>
                ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
