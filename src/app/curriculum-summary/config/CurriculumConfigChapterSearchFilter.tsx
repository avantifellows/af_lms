"use client";

import { useMemo, useState } from "react";

interface ChapterSearchOption {
  id: number;
  code: string;
  name: string;
  grade: number;
  subjectName: string;
}

interface CurriculumConfigChapterSearchFilterProps {
  options: ChapterSearchOption[];
  defaultValue: string;
  defaultChapterId: number | null;
}

const MAX_VISIBLE_OPTIONS = 20;

export default function CurriculumConfigChapterSearchFilter({
  options,
  defaultValue,
  defaultChapterId,
}: CurriculumConfigChapterSearchFilterProps) {
  const initialOption = options.find(
    (option) =>
      option.id === defaultChapterId ||
      option.code.toLowerCase() === defaultValue.toLowerCase()
  );
  const [query, setQuery] = useState(
    initialOption ? formatOptionLabel(initialOption) : defaultValue
  );
  const [submittedValue, setSubmittedValue] = useState(defaultValue);
  const [submittedChapterId, setSubmittedChapterId] = useState(
    initialOption ? String(initialOption.id) : defaultChapterId ? String(defaultChapterId) : ""
  );
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return options
      .filter((option) => {
        if (!normalizedQuery) return true;
        return `${option.code} ${option.name} ${option.grade} ${option.subjectName}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice(0, MAX_VISIBLE_OPTIONS);
  }, [options, query]);

  function selectOption(option: ChapterSearchOption) {
    setQuery(formatOptionLabel(option));
    setSubmittedValue("");
    setSubmittedChapterId(String(option.id));
    setActiveIndex(0);
    setIsOpen(false);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setSubmittedValue(value);
    setSubmittedChapterId("");
    setActiveIndex(0);
    setIsOpen(true);
  }

  return (
    <div className="flex flex-col gap-1 text-sm font-bold text-text-primary md:col-span-2">
      <label htmlFor="curriculum-config-top-chapter-search">Chapter search</label>
      <input type="hidden" name="search" value={submittedValue} />
      <input type="hidden" name="chapter_id" value={submittedChapterId} />
      <div className="relative">
        <input
          id="curriculum-config-top-chapter-search"
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls="curriculum-config-top-chapter-options"
          onChange={(event) => updateQuery(event.currentTarget.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 100);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((index) =>
                visibleOptions.length === 0
                  ? 0
                  : Math.min(index + 1, visibleOptions.length - 1)
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && isOpen && visibleOptions[activeIndex]) {
              event.preventDefault();
              selectOption(visibleOptions[activeIndex]);
            } else if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
          className="min-h-[44px] w-full rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
          placeholder="Search by chapter code or name"
        />
        {isOpen ? (
          <div
            id="curriculum-config-top-chapter-options"
            role="listbox"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-bg-card shadow-lg"
          >
            {visibleOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-muted">
                No matching chapters
              </div>
            ) : (
              visibleOptions.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    index === activeIndex
                      ? "bg-hover-bg text-text-primary"
                      : "text-text-secondary"
                  } hover:bg-hover-bg hover:text-text-primary`}
                >
                  <span className="font-medium text-text-primary">{option.name}</span>
                  <span className="ml-2 font-mono text-xs text-text-muted">
                    {option.code}
                  </span>
                  <span className="block text-xs text-text-muted">
                    Grade {option.grade} - {option.subjectName}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatOptionLabel(option: ChapterSearchOption): string {
  return `${option.name} (${option.code})`;
}
