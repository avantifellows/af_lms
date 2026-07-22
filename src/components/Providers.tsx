"use client";

import { SessionProvider } from "next-auth/react";
import AppToaster from "@/components/AppToaster";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <AppToaster />
    </SessionProvider>
  );
}
