"use client";

import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      closeButton={false}
      expand
      gap={10}
      offset={16}
      visibleToasts={4}
      toastOptions={{
        unstyled: true,
        className: "w-[calc(100vw-2rem)] max-w-md",
      }}
    />
  );
}
