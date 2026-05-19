"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Card, Button } from "@/components/ui";

export default function SignOutPage() {
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    await signOut({ callbackUrl: "/" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <Card elevation="xl" className="w-full max-w-sm space-y-6 p-8">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp"
            alt="Avanti Fellows"
            className="h-10 mx-auto mb-4"
          />
          <h1 className="text-xl font-bold text-text-primary">Sign out</h1>
          <p className="mt-2 text-sm text-text-muted">
            Are you sure you want to sign out?
          </p>
        </div>

        <div className="space-y-3">
          <Button
            variant="danger"
            size="lg"
            className="w-full"
            onClick={handleSignOut}
            disabled={loading}
          >
            {loading ? "Signing out..." : "Sign out"}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => window.history.back()}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
