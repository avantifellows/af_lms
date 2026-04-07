import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/permissions";
import Link from "next/link";
import BatchList from "./BatchList";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface Batch {
  id: number;
  name: string;
  batch_id: string;
  program_id: number;
  metadata: { stream?: string; grade?: number } | null;
}

interface Program {
  id: number;
  name: string;
}

// JNV NVS program ID - hardcoded for now
const DEFAULT_PROGRAM_ID = 64;

async function getBatches(programId: number): Promise<Batch[]> {
  const response = await fetch(
    `${DB_SERVICE_URL}/batch?program_id=${programId}`,
    {
      headers: {
        Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    console.error("Failed to fetch batches");
    return [];
  }

  return response.json();
}

async function getPrograms(): Promise<Program[]> {
  // For now, just return JNV NVS. Later this can fetch all programs.
  return [
    { id: 64, name: "JNV NVS" },
  ];
}

export default async function BatchManagementPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    redirect("/dashboard");
  }

  const [batches, programs] = await Promise.all([
    getBatches(DEFAULT_PROGRAM_ID),
    getPrograms(),
  ]);

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b-2 border-accent shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-text-muted hover:text-text-primary p-1 -m-1">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">Batch Metadata</h1>
              <p className="text-xs text-text-muted">Configure stream and grade metadata</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-text-muted font-mono hidden sm:inline">{session.user.email}</span>
            <Link
              href="/api/auth/signout"
              className="text-sm font-bold text-danger hover:text-danger/80"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <BatchList
          initialBatches={batches}
          programs={programs}
          initialProgramId={DEFAULT_PROGRAM_ID}
        />
      </main>
    </div>
  );
}
