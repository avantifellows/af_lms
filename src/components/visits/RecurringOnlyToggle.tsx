"use client";

import { usePathname, useRouter } from "next/navigation";

// The School-wise tab's "Recurring concerns only" checkbox (`recurring=1`). Ticking or unticking
// keeps every other param and drops `page`, as the filter bar does.
export default function RecurringOnlyToggle({
  currentParams,
}: {
  currentParams: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function setRecurringOnly(checked: boolean) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(currentParams)) {
      if (value && key !== "page" && key !== "recurring") {
        params.set(key, value);
      }
    }
    if (checked) {
      params.set("recurring", "1");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
      <input
        type="checkbox"
        defaultChecked={currentParams.recurring === "1"}
        onChange={(event) => setRecurringOnly(event.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      Recurring concerns only
    </label>
  );
}
