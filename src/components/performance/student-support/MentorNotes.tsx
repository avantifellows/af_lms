"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useJsonFetch } from "../chapter-report/useJsonFetch";
import type { MentorInteraction } from "@/types/student-support";

interface Props {
  schoolUdise: string;
  grade: number;
  program: string;
  uid: string;
  name: string;
  onClose: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Imported";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** The "N notes" cell: a button when there are notes the viewer may read. */
export function NotesCell({ count, onOpen }: { count: number | undefined; onOpen: () => void }) {
  if (!count) return <span className="text-text-muted">—</span>;
  return (
    <button type="button" onClick={onOpen} className="text-accent font-semibold hover:underline whitespace-nowrap">
      {count} {count === 1 ? "note" : "notes"}
    </button>
  );
}

/** One interaction at a time, newest first. Escape or clicking outside closes. */
export default function MentorNotes({ schoolUdise, grade, program, uid, name, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const qs = new URLSearchParams({ grade: String(grade), program, student: uid });
  const state = useJsonFetch<{ interactions: MentorInteraction[] }>(
    `/api/quiz-analytics/${schoolUdise}/student-support/notes?${qs}`,
    "Failed to load the mentor notes"
  );

  let body;
  if (state.status === "loading") body = <p className="text-text-muted">Loading notes…</p>;
  else if (state.status === "error") body = <p className="text-text-muted">{state.message}</p>;
  else if (state.data.interactions.length === 0) body = <p className="text-text-muted">No notes yet.</p>;
  else {
    const all = state.data.interactions;
    const it = all[Math.min(index, all.length - 1)];
    body = (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} className="disabled:opacity-40">
            ‹ Newer
          </button>
          <span>
            Interaction {index + 1} of {all.length}
          </span>
          <button
            type="button"
            disabled={index >= all.length - 1}
            onClick={() => setIndex(index + 1)}
            className="disabled:opacity-40"
          >
            Older ›
          </button>
        </div>
        <div>
          <div className="font-semibold">{it.title}</div>
          <div className="text-xs text-text-muted">
            {formatDate(it.date)}
            {it.mentor ? ` · ${it.mentor}` : ""}
          </div>
        </div>
        <dl className="space-y-2">
          {it.answers.map((a, i) => (
            <div key={i}>
              <dt className="text-xs font-semibold text-text-muted">{a.question}</dt>
              <dd className="whitespace-pre-wrap">{a.answer?.trim() ? a.answer : "—"}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <Modal open onClose={onClose}>
      <div className="max-w-lg max-h-[80vh] overflow-y-auto space-y-3 rounded-xl bg-bg-card p-5 text-sm">
        <h4 className="text-base font-bold">Mentor notes · {name}</h4>
        {body}
        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-text-muted">
          <span>Mentor&apos;s post-session notes, as written.</span>
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1 text-sm">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
