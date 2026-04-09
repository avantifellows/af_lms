"use client";

interface RadioPairProps {
  name: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  yesTestId?: string;
  noTestId?: string;
}

export function RadioPair({
  name,
  value,
  onChange,
  disabled,
  yesTestId,
  noTestId,
}: RadioPairProps) {
  return (
    <div className="flex items-center gap-3">
      <label className="flex min-h-[48px] items-center gap-2 cursor-pointer rounded-lg px-3 py-2 text-sm text-text-primary hover:bg-hover-bg transition-colors">
        <input
          type="radio"
          name={name}
          checked={value === true}
          onChange={() => onChange(true)}
          disabled={disabled}
          className="h-4 w-4 accent-accent"
          data-testid={yesTestId}
        />
        Yes
      </label>
      <label className="flex min-h-[48px] items-center gap-2 cursor-pointer rounded-lg px-3 py-2 text-sm text-text-primary hover:bg-hover-bg transition-colors">
        <input
          type="radio"
          name={name}
          checked={value === false}
          onChange={() => onChange(false)}
          disabled={disabled}
          className="h-4 w-4 accent-accent"
          data-testid={noTestId}
        />
        No
      </label>
    </div>
  );
}
