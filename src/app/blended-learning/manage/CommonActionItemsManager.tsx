"use client";

import { Pencil, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Card, FormLabel } from "@/components/ui";
import type { CommonActionItem, TargetMentor } from "@/lib/blended-learning-common-action-items";
import { COMMON_ITEM_TEXT_MAX, type CommonItemOwner } from "@/lib/blended-learning-manage-input";

import { OwnerPill } from "../students/[id]/ActionItemMeta";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldError, TextAreaField } from "./fields";
import { manageRequest, students } from "./manageRequest";
import { NewCommonItemForm } from "./NewCommonItemForm";
import { OwnerSelect } from "./OwnerSelect";
import { targetLabel } from "./targetLabel";

// The Manage page's Common Action Items: push a new one, and for each one in
// force see its target and how many of its Action Items are open and done.
// Editing the text or owner changes the still-open ones; pushing again adds it
// to targeted Students who don't have it yet; removing deletes the still-open
// ones and keeps the done ones. Every change re-reads the page.

type Pending = { kind: "push" | "remove"; item: CommonActionItem };

function EditCommonItemForm({ item, onDone }: { item: CommonActionItem; onDone: () => void }) {
  const router = useRouter();
  const [text, setText] = useState(item.text);
  const [owner, setOwner] = useState<CommonItemOwner>(item.owner);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await manageRequest(`/api/blended-learning/common-action-items/${item.id}`, {
      method: "PATCH",
      body: { text, owner },
    });
    setBusy(false);
    if (!result.ok) return setErrors(Object.keys(result.fieldErrors).length > 0 ? result.fieldErrors : { form: result.error });
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={save} aria-label="Edit program action item" className="space-y-3">
      <TextAreaField label="Action item" value={text} maxLength={COMMON_ITEM_TEXT_MAX} onChange={setText} error={errors.text} />
      <div className="sm:max-w-xs">
        <FormLabel htmlFor={`common-owner-${item.id}`}>Who does it</FormLabel>
        <OwnerSelect id={`common-owner-${item.id}`} value={owner} onChange={setOwner} />
        <FieldError message={errors.owner} />
      </div>
      <p className="text-xs text-text-secondary">
        Changes the {students(item.openCount)} who still have it open. Done ones stay as they were.
      </p>
      <FieldError message={errors.form} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Counts({ item }: { item: CommonActionItem }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
      <div className="flex gap-1">
        <dt>Open</dt>
        <dd className="font-mono font-bold text-text-primary">{item.openCount}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Done</dt>
        <dd className="font-mono font-bold text-text-primary">{item.doneCount}</dd>
      </div>
      {item.notYetAdded > 0 && (
        <div className="flex gap-1">
          <dt>Not yet added</dt>
          <dd className="font-mono font-bold text-text-primary">{item.notYetAdded}</dd>
        </div>
      )}
    </dl>
  );
}

function CommonItemView({
  item,
  onEdit,
  onPending,
}: {
  item: CommonActionItem;
  onEdit: () => void;
  onPending: (pending: Pending) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="flex min-w-0 items-baseline gap-2.5 text-sm text-text-primary">
        <OwnerPill owner={item.owner} />
        <span className="min-w-0 break-words">{item.text}</span>
      </p>
      <p className="text-xs text-text-muted">{targetLabel(item.target, item.targetMentorName)}</p>
      <Counts item={item} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="secondary" size="md" onClick={onEdit} aria-label={`Edit: ${item.text}`}>
          <Pencil aria-hidden="true" className="h-4 w-4" />
          Edit
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onPending({ kind: "push", item })}
          disabled={item.notYetAdded === 0}
          aria-label={`Push again: ${item.text}`}
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          Push again
        </Button>
        <Button type="button" variant="danger-ghost" onClick={() => onPending({ kind: "remove", item })} aria-label={`Remove: ${item.text}`}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Remove
        </Button>
      </div>
    </div>
  );
}

function PendingDialog({
  pending,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  pending: Pending | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const item = pending?.item;
  const push = pending?.kind === "push";
  return (
    <ConfirmDialog
      open={pending !== null}
      title={push ? "Push this action item again?" : "Remove this action item?"}
      confirmLabel={push ? "Push" : "Remove"}
      danger={!push}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="break-words font-bold text-text-primary">{item?.text}</p>
      {item && push && <p>Will be added to {students(item.notYetAdded)} who don&apos;t have it yet.</p>}
      {item && !push && (
        <p>
          Deletes it from the {students(item.openCount)} who still have it open. The {item.doneCount} done stay in
          their history.
        </p>
      )}
    </ConfirmDialog>
  );
}

function usePendingAction() {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const url = `/api/blended-learning/common-action-items/${pending.item.id}`;
    const result = await (pending.kind === "push"
      ? manageRequest(`${url}/push`, { method: "POST" })
      : manageRequest(url, { method: "DELETE" }));
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPending(null);
    router.refresh();
  }

  const cancel = () => {
    setPending(null);
    setError(null);
  };
  return { pending, setPending, busy, error, confirm, cancel };
}

export function CommonActionItemsManager({ items, mentors }: { items: CommonActionItem[]; mentors: TargetMentor[] }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const action = usePendingAction();

  return (
    <section aria-labelledby="manage-common-items">
      <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 id="manage-common-items" className="text-lg font-bold text-text-primary">
            Program action items
          </h2>
          <p className="text-sm text-text-secondary">
            Added now to each targeted student&apos;s open action items, tagged &ldquo;From program&rdquo;. Mentors tick them off while
            logging.
          </p>
        </div>
        <NewCommonItemForm mentors={mentors} />
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-bold text-text-primary">Pushed</h3>
          {items.length === 0 ? (
            <p className="mt-1 text-sm text-text-secondary">None yet.</p>
          ) : (
            <ul aria-label="Program action items" className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="py-3">
                  {editingId === item.id ? (
                    <EditCommonItemForm item={item} onDone={() => setEditingId(null)} />
                  ) : (
                    <CommonItemView item={item} onEdit={() => setEditingId(item.id)} onPending={action.setPending} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <PendingDialog
        pending={action.pending}
        busy={action.busy}
        error={action.error}
        onConfirm={action.confirm}
        onCancel={action.cancel}
      />
    </section>
  );
}
