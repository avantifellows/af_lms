"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";

// A table row that opens `href` when clicked anywhere. Keep a real link inside the row (for
// keyboard users and new-tab clicks); clicks on links and buttons are left to them.
export default function ClickableTableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if (event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest("a, button")) return;
    router.push(href);
  }

  return (
    <tr onClick={handleClick} className={`cursor-pointer ${className ?? ""}`}>
      {children}
    </tr>
  );
}
