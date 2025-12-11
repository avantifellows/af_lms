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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Batch Metadata
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Configure stream and grade metadata for program batches
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Back to Admin
            </Link>
            <span className="text-sm text-gray-500">{session.user.email}</span>
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
