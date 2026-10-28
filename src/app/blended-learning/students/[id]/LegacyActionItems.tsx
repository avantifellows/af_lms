"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatCalendarDate, istCalendarDateOf } from "@/lib/blended-learning-format";
import type { LegacyActionItemView } from "@/lib/blended-learning-mentee-detail";

import { OwnerPill } from "./ActionItemMeta";

// The Profile Doc conversation's action items, each with a Done checkbox.
// The Student's own Mentor ticks (or unticks) one and it saves at once: the
// box changes straight away and goes back, with the reason, if the save
// fails. Everyone else sees the same boxes, disabled. Once a Conversation
// exists in the app (`superseded`), ticking the last open item refreshes
// the page, which then no longer shows the card.

type TickOutcome = { ok: true; item: LegacyActionItemView } | { ok: false; error: string };

async function saveTick(studentId: number, item: LegacyActionItemView, done: boolean): Promise<TickOutcome> {
  try {
    const res = await fetch(`/api/blended-learning/students/${studentId}/legacy-action-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: item.index, text: item.text, owner: item.owner, done }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.item) return { ok: true, item: json.item };
    return { ok: false, error: json.error ?? "Couldn't save. Try again." };
  } catch {
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }
}

function DoneLine({ item }: { item: LegacyActionItemView }) {
  if (!item.doneAt) return null;
  const parts = ["Done", formatCalendarDate(istCalendarDateOf(item.doneAt)), item.doneByEmail].filter(Boolean);
  return <span className="block text-xs text-success">{parts.join(" · ")}</span>;
}

function ItemRow({
  item,
  canTick,
  pending,
  onToggle,
}: {
  item: LegacyActionItemView;
  canTick: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const done = item.doneAt !== null;
  return (
    <li className="text-sm">
      <label className={`flex min-h-11 items-start gap-3 py-1 ${canTick ? "cursor-pointer" : ""}`}>
        <input
          type="checkbox"
          aria-label={`Done: ${item.text}`}
          checked={done}
          disabled={!canTick || pending}
          onChange={onToggle}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent disabled:opacity-60"
        />
        <span className="flex min-w-0 items-baseline gap-2.5">
          <OwnerPill owner={item.owner} />
          <span className="min-w-0 break-words">
            <span className={done ? "text-text-muted line-through" : "text-text-primary"}>{item.text}</span>
            <DoneLine item={item} />
          </span>
        </span>
      </label>
    </li>
  );
}

export function LegacyActionItems({
  studentId,
  initialItems,
  canTick,
  superseded,
}: {
  studentId: number;
  initialItems: LegacyActionItemView[];
  canTick: boolean;
  superseded: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const replace = (next: LegacyActionItemView) =>
    setItems((current) => current.map((item) => (item.index === next.index ? next : item)));

  async function toggle(item: LegacyActionItemView) {
    const done = item.doneAt === null;
    const ticked = items.map((other) =>
      other.index === item.index ? { ...other, doneAt: done ? new Date().toISOString() : null, doneByEmail: null } : other
    );
    setItems(ticked);
    setError(null);
    setPending((current) => new Set(current).add(item.index));
    const outcome = await saveTick(studentId, item, done);
    setPending((current) => new Set([...current].filter((index) => index !== item.index)));
    if (!outcome.ok) {
      replace(item);
      setError(outcome.error);
      return;
    }
    replace(outcome.item);
    if (superseded && ticked.every((other) => other.doneAt !== null)) router.refresh();
  }

  return (
    <div className="space-y-1">
      <ul aria-label="Action items from Profile Doc" className="space-y-1">
        {items.map((item) => (
          <ItemRow
            key={item.index}
            item={item}
            canTick={canTick}
            pending={pending.has(item.index)}
            onToggle={() => void toggle(item)}
          />
        ))}
      </ul>
      <div aria-live="polite">
        {error && (
          <p data-testid="legacy-item-error" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
