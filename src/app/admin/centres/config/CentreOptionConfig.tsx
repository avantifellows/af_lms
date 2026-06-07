"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";

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
      <div className="border-b border-border pb-4">
        <h2 className="text-lg font-bold uppercase text-text-primary">Option Sets</h2>
        <p className="text-xs font-mono text-text-muted">
          Fixed Centre option sets with immutable option codes
        </p>
      </div>

      {optionSets.map((optionSet) => (
        <section
          key={optionSet.code}
          className="rounded-md border border-border bg-bg-card shadow-sm"
          aria-labelledby={`centre-option-set-${optionSet.code}`}
        >
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3
                id={`centre-option-set-${optionSet.code}`}
                className="text-base font-bold uppercase text-text-primary"
              >
                {optionSet.label}
              </h3>
              <p className="text-xs font-mono text-text-muted">
                {optionSet.allowMulti ? "Multiple values allowed" : "Single value"} · code{" "}
                {optionSet.code}
              </p>
            </div>
            <Button size="sm" onClick={() => openNewOption(optionSet)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New option
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[760px] divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["Code", "Label", "Order", "Active", "Updated", "Actions"].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 text-left text-xs font-bold uppercase text-gray-600"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
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
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-text-muted">
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
    </section>
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
      <tr className="bg-accent/5">
        <td className="px-3 py-2 align-top">
          <Input
            aria-label={`New ${optionSet.label} code`}
            value={draft.code}
            onChange={(event) =>
              onPatch({ code: event.target.value, codeTouched: true })
            }
            className="min-h-[36px] font-mono text-xs"
          />
          {fieldErrors.code && <p className="mt-1 text-xs text-danger">{fieldErrors.code}</p>}
        </td>
        <td className="px-3 py-2 align-top">
          <Input
            aria-label={`New ${optionSet.label} label`}
            value={draft.label}
            onChange={(event) => onLabelChange(event.target.value)}
            className="min-h-[36px]"
          />
          {fieldErrors.label && <p className="mt-1 text-xs text-danger">{fieldErrors.label}</p>}
        </td>
        <td className="px-3 py-2 align-top">
          <Input
            aria-label={`New ${optionSet.label} order`}
            type="number"
            min={0}
            value={draft.sortOrder}
            onChange={(event) =>
              onPatch({ sortOrder: Number.parseInt(event.target.value, 10) || 0 })
            }
            className="min-h-[36px] w-24"
          />
          {fieldErrors.sort_order && (
            <p className="mt-1 text-xs text-danger">{fieldErrors.sort_order}</p>
          )}
        </td>
        <td className="px-3 py-2 align-top">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => onPatch({ isActive: event.target.checked })}
            />
            Active
          </label>
        </td>
        <td className="px-3 py-2 align-top font-mono text-xs text-gray-500">New</td>
        <td className="px-3 py-2 align-top">
          <div className="flex gap-2">
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Check className="h-4 w-4" aria-hidden="true" />
              {saving ? "Saving" : "Save new option"}
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-accent/5">
          <td colSpan={6} className="px-3 pb-3 text-sm text-danger">
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
      <tr className={isActive ? "hover:bg-gray-50" : "bg-gray-50 text-gray-500"}>
        <td className="px-3 py-2 align-top">
          <Input
            aria-label={`${option.label} code`}
            value={option.code}
            disabled
            className="min-h-[36px] bg-gray-100 font-mono text-xs"
          />
        </td>
        <td className="px-3 py-2 align-top">
          <Input
            aria-label={`${option.code} label`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="min-h-[36px]"
          />
          {fieldErrors.label && <p className="mt-1 text-xs text-danger">{fieldErrors.label}</p>}
        </td>
        <td className="px-3 py-2 align-top">
          <Input
            aria-label={`${option.code} order`}
            type="number"
            min={0}
            value={sortOrder}
            onChange={(event) => setSortOrder(Number.parseInt(event.target.value, 10) || 0)}
            className="min-h-[36px] w-24"
          />
          {fieldErrors.sort_order && (
            <p className="mt-1 text-xs text-danger">{fieldErrors.sort_order}</p>
          )}
        </td>
        <td className="px-3 py-2 align-top">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            {isActive ? "Active" : "Inactive"}
          </label>
        </td>
        <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-gray-500">
          {formatDate(updatedAt)}
        </td>
        <td className="px-3 py-2 align-top">
          <Button size="sm" variant="secondary" onClick={save} disabled={saving}>
            <Check className="h-4 w-4" aria-hidden="true" />
            {saving ? "Saving" : "Save"}
          </Button>
        </td>
      </tr>
      {error && (
        <tr className={isActive ? "" : "bg-gray-50"}>
          <td colSpan={6} className="px-3 pb-3 text-sm text-danger">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

function formatDate(value: string) {
  if (!value) return "-";
  return value.slice(0, 10);
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
