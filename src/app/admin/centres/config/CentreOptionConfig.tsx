"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  Check,
  Hash,
  Plus,
  Save,
  Settings2,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";

import { Button, Input } from "@/components/ui";
import type {
  CentreOption,
  CentreOptionSet,
  CentreOptionSetCode,
} from "@/lib/centres";

interface CentreOptionConfigProps {
  initialOptionSets: CentreOptionSet[];
}

interface NewOptionDraft {
  optionSetCode: CentreOptionSetCode;
  label: string;
  code: string;
  sortOrder: number;
  isActive: boolean;
  codeTouched: boolean;
}

export default function CentreOptionConfig({ initialOptionSets }: CentreOptionConfigProps) {
  const [optionSets, setOptionSets] = useState(initialOptionSets);
  const [newDraft, setNewDraft] = useState<NewOptionDraft | null>(null);
  const [savingNew, setSavingNew] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});

  const openNewOption = (optionSet: CentreOptionSet) => {
    setCreateError("");
    setCreateFieldErrors({});
    setNewDraft({
      optionSetCode: optionSet.code,
      label: "",
      code: "",
      sortOrder: nextSortOrder(optionSet.options),
      isActive: true,
      codeTouched: false,
    });
  };

  const patchNewDraft = (patch: Partial<NewOptionDraft>) => {
    setNewDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const changeNewLabel = (label: string) => {
    setNewDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        label,
        code: current.codeTouched ? current.code : suggestOptionCode(label),
      };
    });
  };

  const saveNewOption = async () => {
    if (!newDraft) return;
    setSavingNew(true);
    setCreateError("");
    setCreateFieldErrors({});

    const payload = {
      option_set_code: newDraft.optionSetCode,
      code: newDraft.code,
      label: newDraft.label,
      sort_order: newDraft.sortOrder,
      is_active: newDraft.isActive,
    };

    try {
      const response = await fetch("/api/admin/centres/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setCreateFieldErrors(data.fields ?? {});
        throw new Error(data.error || "Failed to create Centre option");
      }

      const saved = data.option as CentreOption;
      setOptionSets((current) =>
        current.map((optionSet) =>
          optionSet.code === saved.optionSetCode
            ? {
                ...optionSet,
                options: [...optionSet.options, saved].sort(sortOptions),
              }
            : optionSet
        )
      );
      setNewDraft(null);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create Centre option");
    } finally {
      setSavingNew(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-bold uppercase text-text-primary">Option Configuration</h2>
          <p className="mt-1 text-sm text-text-muted">
            Manage labels, ordering, and active state for Centre dropdown values.
          </p>
        </div>
        <div className="rounded-full border border-border bg-bg-card px-3 py-1.5 text-xs font-semibold uppercase text-text-muted shadow-sm">
          Codes are immutable after creation
        </div>
      </div>

      <div className="space-y-4">
        {optionSets.map((optionSet) => (
          <section
            key={optionSet.code}
            className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm"
            aria-labelledby={`centre-option-set-${optionSet.code}`}
          >
            <div className="border-b border-border bg-bg-card px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3
                    id={`centre-option-set-${optionSet.code}`}
                    className="text-base font-bold uppercase text-text-primary"
                  >
                    {optionSet.label}
                  </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <MetaPill icon={<Hash className="h-3.5 w-3.5" aria-hidden="true" />}>
                    {optionSet.code}
                  </MetaPill>
                  <MetaPill
                    icon={<Settings2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    {optionSet.allowMulti ? "Multi-select" : "Single-select"}
                  </MetaPill>
                  <MetaPill icon={<ToggleRight className="h-3.5 w-3.5" aria-hidden="true" />}>
                    {optionSet.options.filter((option) => option.isActive).length} active
                  </MetaPill>
                </div>
                </div>
                <Button size="md" onClick={() => openNewOption(optionSet)} className="shrink-0">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New option
                </Button>
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-bg-card-alt shadow-[inset_0_-1px_0_var(--color-border)]">
                  <tr>
                    {["Code", "Display Label", "Order", "Status", "Updated", "Action"].map(
                      (header) => (
                        <th
                          key={header}
                          scope="col"
                          className="whitespace-nowrap px-3 py-3 text-left text-xs font-bold uppercase text-text-muted"
                        >
                          {header}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="bg-bg-card">
                  {newDraft?.optionSetCode === optionSet.code && (
                    <NewOptionRow
                      optionSet={optionSet}
                      draft={newDraft}
                      saving={savingNew}
                      error={createError}
                      fieldErrors={createFieldErrors}
                      onLabelChange={changeNewLabel}
                      onPatch={patchNewDraft}
                      onSave={saveNewOption}
                      onCancel={() => setNewDraft(null)}
                    />
                  )}
                  {optionSet.options.length === 0 && newDraft?.optionSetCode !== optionSet.code ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-text-muted">
                        No options configured
                      </td>
                    </tr>
                  ) : (
                    optionSet.options.map((option) => (
                      <OptionRow
                        key={option.id}
                        option={option}
                        onSaved={(saved) =>
                          setOptionSets((current) =>
                            current.map((currentSet) =>
                              currentSet.code === saved.optionSetCode
                                ? {
                                    ...currentSet,
                                    options: currentSet.options
                                      .map((currentOption) =>
                                        currentOption.id === saved.id ? saved : currentOption
                                      )
                                      .sort(sortOptions),
                                  }
                                : currentSet
                            )
                          )
                        }
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function MetaPill({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card-alt px-2.5 py-1 text-xs font-semibold text-text-secondary">
      {icon}
      {children}
    </span>
  );
}

function NewOptionRow({
  optionSet,
  draft,
  saving,
  error,
  fieldErrors,
  onLabelChange,
  onPatch,
  onSave,
  onCancel,
}: {
  optionSet: CentreOptionSet;
  draft: NewOptionDraft;
  saving: boolean;
  error: string;
  fieldErrors: Record<string, string>;
  onLabelChange: (label: string) => void;
  onPatch: (patch: Partial<NewOptionDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <tr className="bg-hover-bg">
        <td className="border-b border-border px-3 py-3 align-top">
          <Input
            aria-label={`New ${optionSet.label} code`}
            value={draft.code}
            onChange={(event) =>
              onPatch({ code: event.target.value, codeTouched: true })
            }
            className="font-mono text-xs"
          />
          {fieldErrors.code && <p className="mt-1 text-xs text-danger">{fieldErrors.code}</p>}
        </td>
        <td className="border-b border-border px-3 py-3 align-top">
          <Input
            aria-label={`New ${optionSet.label} label`}
            value={draft.label}
            onChange={(event) => onLabelChange(event.target.value)}
          />
          {fieldErrors.label && <p className="mt-1 text-xs text-danger">{fieldErrors.label}</p>}
        </td>
        <td className="border-b border-border px-3 py-3 align-top">
          <Input
            aria-label={`New ${optionSet.label} order`}
            type="number"
            min={0}
            value={draft.sortOrder}
            onChange={(event) =>
              onPatch({ sortOrder: Number.parseInt(event.target.value, 10) || 0 })
            }
            className="w-24"
          />
          {fieldErrors.sort_order && (
            <p className="mt-1 text-xs text-danger">{fieldErrors.sort_order}</p>
          )}
        </td>
        <td className="border-b border-border px-3 py-3 align-top">
          <label className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-bg-input px-3 text-sm font-semibold text-text-primary">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => onPatch({ isActive: event.target.checked })}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span>{draft.isActive ? "Active" : "Inactive"}</span>
          </label>
        </td>
        <td className="border-b border-border px-3 py-3 align-top">
          <span className="inline-flex min-h-[44px] items-center font-mono text-xs text-text-muted">
            New
          </span>
        </td>
        <td className="border-b border-border px-3 py-3 align-top">
          <div className="flex items-center gap-2">
            <Button size="md" onClick={onSave} disabled={saving} className="min-w-36">
              <Check className="h-4 w-4" aria-hidden="true" />
              {saving ? "Saving" : "Save new option"}
            </Button>
            <Button size="md" variant="secondary" onClick={onCancel} disabled={saving}>
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-hover-bg">
          <td colSpan={6} className="border-b border-border px-3 pb-3 text-sm text-danger">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

function OptionRow({
  option,
  onSaved,
}: {
  option: CentreOption;
  onSaved: (option: CentreOption) => void;
}) {
  const [label, setLabel] = useState(option.label);
  const [sortOrder, setSortOrder] = useState(option.sortOrder);
  const [isActive, setIsActive] = useState(option.isActive);
  const [updatedAt, setUpdatedAt] = useState(option.updatedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setSaving(true);
    setError("");
    setFieldErrors({});

    const payload = {
      label,
      sort_order: sortOrder,
      is_active: isActive,
    };

    try {
      const response = await fetch(`/api/admin/centres/options/${option.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(data.fields ?? {});
        throw new Error(data.error || "Failed to save Centre option");
      }

      const saved = data.option as CentreOption;
      setLabel(saved.label);
      setSortOrder(saved.sortOrder);
      setIsActive(saved.isActive);
      setUpdatedAt(saved.updatedAt);
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Centre option");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <tr className="group">
        <td className={`border-b border-border px-3 py-3 align-top transition-colors group-hover:bg-[#fff3e9] ${isActive ? "bg-bg-card" : "bg-bg-card-alt"}`}>
          <Input
            aria-label={`${option.label} code`}
            value={option.code}
            disabled
            className="bg-bg-card-alt font-mono text-xs"
          />
        </td>
        <td className={`border-b border-border px-3 py-3 align-top transition-colors group-hover:bg-[#fff3e9] ${isActive ? "bg-bg-card" : "bg-bg-card-alt"}`}>
          <Input
            aria-label={`${option.code} label`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          {fieldErrors.label && <p className="mt-1 text-xs text-danger">{fieldErrors.label}</p>}
        </td>
        <td className={`border-b border-border px-3 py-3 align-top transition-colors group-hover:bg-[#fff3e9] ${isActive ? "bg-bg-card" : "bg-bg-card-alt"}`}>
          <Input
            aria-label={`${option.code} order`}
            type="number"
            min={0}
            value={sortOrder}
            onChange={(event) => setSortOrder(Number.parseInt(event.target.value, 10) || 0)}
            className="w-24"
          />
          {fieldErrors.sort_order && (
            <p className="mt-1 text-xs text-danger">{fieldErrors.sort_order}</p>
          )}
        </td>
        <td className={`border-b border-border px-3 py-3 align-top transition-colors group-hover:bg-[#fff3e9] ${isActive ? "bg-bg-card" : "bg-bg-card-alt"}`}>
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-input px-3 text-sm font-semibold text-text-primary">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              aria-label="Active"
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <StatusPill active={isActive} />
          </label>
        </td>
        <td className={`whitespace-nowrap border-b border-border px-3 py-3 align-top transition-colors group-hover:bg-[#fff3e9] ${isActive ? "bg-bg-card" : "bg-bg-card-alt"}`}>
          <span className="inline-flex min-h-[44px] items-center font-mono text-xs text-text-muted">
            {formatDate(updatedAt)}
          </span>
        </td>
        <td className={`border-b border-border px-3 py-3 align-top transition-colors group-hover:bg-[#fff3e9] ${isActive ? "bg-bg-card" : "bg-bg-card-alt"}`}>
          <Button size="md" variant="secondary" onClick={save} disabled={saving} className="min-w-24">
            <Save className="h-4 w-4" aria-hidden="true" />
            {saving ? "Saving" : "Save"}
          </Button>
        </td>
      </tr>
      {error && (
        <tr className={isActive ? "bg-bg-card" : "bg-bg-card-alt"}>
          <td colSpan={6} className="border-b border-border px-3 pb-3 text-sm text-danger">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        active ? "bg-success-bg text-success" : "bg-warning-bg text-warning-text"
      }`}
    >
      {active ? (
        <ToggleRight className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ToggleLeft className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function nextSortOrder(options: CentreOption[]) {
  return options.reduce((max, option) => Math.max(max, option.sortOrder), 0) + 1;
}

function sortOptions(a: CentreOption, b: CentreOption) {
  return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label);
}

function suggestOptionCode(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
