"use client";

import { useState } from "react";

export default function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address is selectable in the field.
    }
  };

  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={address}
        aria-label="Connector address"
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text-primary"
      />
      <button
        type="button"
        onClick={copy}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-text-on-accent hover:bg-accent-hover"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
