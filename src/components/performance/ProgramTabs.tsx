"use client";

interface Props {
  programs: string[];
  selected: string | null;
  onChange: (program: string) => void;
}

export default function ProgramTabs({ programs, selected, onChange }: Props) {
  return (
    <div className="flex gap-1 flex-wrap">
      {programs.map((prog) => (
        <button
          key={prog}
          onClick={() => onChange(prog)}
          className={`px-3 md:px-4 py-1.5 md:py-2 min-h-[44px] text-xs md:text-sm font-bold uppercase tracking-wide rounded-lg transition-colors ${
            selected === prog
              ? "bg-accent text-text-on-accent shadow-sm"
              : "bg-bg-card-alt text-text-muted border border-border hover:border-accent/50 hover:text-text-primary"
          }`}
        >
          {prog}
        </button>
      ))}
    </div>
  );
}
