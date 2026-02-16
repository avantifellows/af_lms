"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LoadingLinkProps {
  href: string;
  children: React.ReactNode;
  loadingText?: string;
  className?: string;
}

export default function LoadingLink({
  href,
  children,
  loadingText,
  className,
}: LoadingLinkProps) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <button
      type="button"
      disabled={isNavigating}
      className={className}
      onClick={() => {
        setIsNavigating(true);
        router.push(href);
      }}
    >
      {isNavigating ? (
        <span className="flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {loadingText ?? children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
