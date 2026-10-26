import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

import { Select } from "@/components/ui";

// Every Blended Learning select: the browser's own arrow replaced by a
// chevron inset from the right border, with room for it in the padding, so
// the list filters, the Flags filters and the log form's selects all match.
// `wrapperClassName` places the select (grid spans and the like).
export function BlendedSelect({
  wrapperClassName = "",
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <Select {...props} className={`h-11 appearance-none truncate py-0 pl-3 pr-9 ${className}`} />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
}
