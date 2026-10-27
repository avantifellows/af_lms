"use client";

import { ArrowDown, ArrowUp, BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Card } from "@/components/ui";
import { RESOURCE_TITLE_MAX } from "@/lib/blended-learning-manage-input";
import type { Resource } from "@/lib/blended-learning-resources";

import { ExternalLink } from "../ExternalLink";
import { ConfirmDialog } from "./ConfirmDialog";
import { TextField } from "./fields";
import { manageRequest } from "./manageRequest";

// The Manage page's Resources: what Mentors see on the Resources tab, in this
// order. Add one (it goes last), edit its title and link in place, move it up
// or down, or remove it after a confirmation. Every change re-reads the page.

type Values = { title: string; url: string };
type Errors = Record<string, string>;

const EMPTY: Values = { title: "", url: "" };

function ResourceFields({ values, errors, onChange }: { values: Values; errors: Errors; onChange: (values: Values) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        label="Title"
        value={values.title}
        maxLength={RESOURCE_TITLE_MAX}
        onChange={(title) => onChange({ ...values, title })}
        error={errors.title}
      />
      <TextField
        label="Link"
        type="url"
        placeholder="https://"
        value={values.url}
        onChange={(url) => onChange({ ...values, url })}
        error={errors.url}
      />
    </div>
  );
}

// A form's values, errors and save: on success the page refreshes and
// `onSaved` runs (the add form then starts again empty); on failure the field
// errors (or the error) show.
function useResourceForm(
  initial: Values,
  save: (values: Values) => ReturnType<typeof manageRequest>,
  onSaved: (reset: () => void) => void
) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await save(values);
    setBusy(false);
    if (!result.ok) {
      setErrors(Object.keys(result.fieldErrors).length > 0 ? result.fieldErrors : { form: result.error });
      return;
    }
    setErrors({});
    onSaved(() => setValues(initial));
    router.refresh();
  }

  return { values, setValues, errors, busy, submit };
}

function AddResourceForm() {
  const form = useResourceForm(
    EMPTY,
    (values) => manageRequest("/api/blended-learning/resources", { method: "POST", body: values }),
    (reset) => reset()
  );
  return (
    <form onSubmit={form.submit} aria-label="Add a resource" className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-bold text-text-primary">Add a resource</h3>
      <ResourceFields values={form.values} errors={form.errors} onChange={form.setValues} />
      {form.errors.form && <p className="text-sm text-danger">{form.errors.form}</p>}
      <Button type="submit" disabled={form.busy} className="w-full sm:w-auto">
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add resource
      </Button>
    </form>
  );
}

function EditResourceForm({ resource, onDone }: { resource: Resource; onDone: () => void }) {
  const form = useResourceForm(
    { title: resource.title, url: resource.url },
    (values) => manageRequest(`/api/blended-learning/resources/${resource.id}`, { method: "PATCH", body: values }),
    () => onDone()
  );
  return (
    <form onSubmit={form.submit} aria-label={`Edit ${resource.title}`} className="space-y-3">
      <ResourceFields values={form.values} errors={form.errors} onChange={form.setValues} />
      {form.errors.form && <p className="text-sm text-danger">{form.errors.form}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={form.busy}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} disabled={form.busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type RowActions = {
  onMove: (direction: "up" | "down") => void;
  onEdit: () => void;
  onRemove: () => void;
};

function ResourceRow({
  resource,
  first,
  last,
  busy,
  actions,
}: {
  resource: Resource;
  first: boolean;
  last: boolean;
  busy: boolean;
  actions: RowActions;
}) {
  const icon = "h-11 w-11 shrink-0";
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <ExternalLink href={resource.url} icon={BookOpen}>
          {resource.title}
        </ExternalLink>
        <p className="truncate text-xs text-text-muted">{resource.url}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="icon" className={icon} aria-label={`Move ${resource.title} up`} disabled={busy || first} onClick={() => actions.onMove("up")}>
          <ArrowUp aria-hidden="true" className="h-5 w-5" />
        </Button>
        <Button type="button" variant="icon" className={icon} aria-label={`Move ${resource.title} down`} disabled={busy || last} onClick={() => actions.onMove("down")}>
          <ArrowDown aria-hidden="true" className="h-5 w-5" />
        </Button>
        <Button type="button" variant="icon" className={icon} aria-label={`Edit ${resource.title}`} disabled={busy} onClick={actions.onEdit}>
          <Pencil aria-hidden="true" className="h-5 w-5" />
        </Button>
        <Button type="button" variant="icon" className={`${icon} hover:text-danger`} aria-label={`Remove ${resource.title}`} disabled={busy} onClick={actions.onRemove}>
          <Trash2 aria-hidden="true" className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

// Moving and removing: one request at a time, then the page re-reads.
function useResourceActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Resource | null>(null);

  async function run(request: Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await request;
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return false;
    }
    router.refresh();
    return true;
  }

  const move = (resource: Resource, direction: "up" | "down") =>
    run(manageRequest(`/api/blended-learning/resources/${resource.id}/move`, { method: "POST", body: { direction } }));

  async function confirmRemove() {
    if (removing && (await run(manageRequest(`/api/blended-learning/resources/${removing.id}`, { method: "DELETE" })))) {
      setRemoving(null);
    }
  }

  return { busy, error, removing, setRemoving, setError, move, confirmRemove };
}

export function ResourcesManager({ resources }: { resources: Resource[] }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const actions = useResourceActions();
  const { removing } = actions;

  return (
    <section aria-labelledby="manage-resources">
      <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 id="manage-resources" className="text-lg font-bold text-text-primary">
            Resources
          </h2>
          <p className="text-sm text-text-secondary">Mentors see these on the Resources tab, in this order.</p>
        </div>
        {actions.error && !removing && (
          <p role="alert" className="text-sm text-danger">
            {actions.error}
          </p>
        )}
        {resources.length === 0 ? (
          <p className="text-sm text-text-secondary">No resources yet.</p>
        ) : (
          <ol aria-label="Resources" className="divide-y divide-border">
            {resources.map((resource, index) => (
              <li key={resource.id} className="py-3 first:pt-0">
                {editingId === resource.id ? (
                  <EditResourceForm resource={resource} onDone={() => setEditingId(null)} />
                ) : (
                  <ResourceRow
                    resource={resource}
                    first={index === 0}
                    last={index === resources.length - 1}
                    busy={actions.busy}
                    actions={{
                      onMove: (direction) => actions.move(resource, direction),
                      onEdit: () => setEditingId(resource.id),
                      onRemove: () => actions.setRemoving(resource),
                    }}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        <AddResourceForm />
      </Card>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this resource?"
        confirmLabel="Remove"
        danger
        busy={actions.busy}
        error={removing ? actions.error : null}
        onConfirm={actions.confirmRemove}
        onCancel={() => {
          actions.setRemoving(null);
          actions.setError(null);
        }}
      >
        <p>
          <span className="font-bold text-text-primary">{removing?.title}</span> will no longer show on the Resources
          tab.
        </p>
      </ConfirmDialog>
    </section>
  );
}
