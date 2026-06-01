"use client";

import { useRouter } from "next/navigation";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

export default function CurriculumSummaryPageSizeSelect({
  currentParams,
  pageSize,
}: {
  currentParams: Record<string, string | undefined>;
  pageSize: number;
}) {
  const router = useRouter();

  function handlePageSizeChange(nextPageSize: string) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(currentParams)) {
      if (value && key !== "page" && key !== "limit") {
        params.set(key, value);
      }
    }

    const parsedPageSize = Number(nextPageSize);
    if (parsedPageSize !== DEFAULT_PAGE_SIZE) {
      params.set("limit", String(parsedPageSize));
    }

    const query = params.toString();
    router.push(query ? `/curriculum-summary?${query}` : "/curriculum-summary");
  }

  return (
    <label className="flex items-center gap-2 text-sm text-text-secondary">
      <span>Show:</span>
      <select
        aria-label="Rows per page"
        value={pageSize}
        onChange={(event) => handlePageSizeChange(event.target.value)}
        className="rounded-md border border-border bg-bg-card px-2 py-1.5 text-sm font-bold text-text-primary"
      >
        {PAGE_SIZE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
