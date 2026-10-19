"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

// A GET filter form whose controls always show the current URL. The controls are uncontrolled
// (`defaultValue` / `defaultChecked` from the search params), and on browser Back / Forward the
// browser restores whatever was typed or ticked on that page before Apply, or brings the page
// back from the back/forward cache as it was left. Resetting the form puts every control back to
// the defaults rendered from its URL. Key the form on the search params as well, so a client-side
// navigation that keeps this component mounted starts it again.
export default function UrlFilterForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    form?.reset();
    const resetRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) form?.reset();
    };
    window.addEventListener("pageshow", resetRestoredPage);
    return () => window.removeEventListener("pageshow", resetRestoredPage);
  }, []);

  return (
    <form ref={formRef} action={action} className={className}>
      {children}
    </form>
  );
}
