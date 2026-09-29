"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

const IS_DEV = process.env.NODE_ENV !== "production";

const DEV_PERSONAS = [
  { key: "admin", label: "Admin", description: "Level 3, all schools" },
  { key: "program_manager", label: "Program Manager", description: "Excluded from mentorship" },
  { key: "program_admin", label: "Program Admin", description: "Excluded from mentorship" },
  { key: "teacher", label: "Teacher", description: "Level 1, 1 school" },
  { key: "former_mentor", label: "Former Mentor", description: "No active mentees" },
  { key: "holistic_admin", label: "Holistic Admin", description: "All supported programs, mentorship only" },
  { key: "read_only", label: "Read-Only", description: "Teacher view without edits" },
] as const;

export default function LoginPage() {
  const [devLoading, setDevLoading] = useState<string | null>(null);
  const router = useRouter();

  const handleDevLogin = async (persona: string) => {
    setDevLoading(persona);
    const result = await signIn("dev-login", { persona, redirect: false });
    setDevLoading(null);
    if (result?.ok) {
      router.push("/dashboard");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card elevation="xl" className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Avanti Fellows</h1>
          <p className="mt-2 text-sm text-gray-600">Student Enrollment Management</p>
        </div>

        <div className="mt-8 space-y-4">
          <button
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>

          {IS_DEV && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-white px-2 text-gray-500">dev login</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {DEV_PERSONAS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => handleDevLogin(p.key)}
                    disabled={devLoading !== null}
                    className="rounded-lg border border-dashed border-orange-300 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors"
                  >
                    {devLoading === p.key ? "..." : p.label}
                    <span className="block text-[10px] font-normal text-orange-500">{p.description}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
