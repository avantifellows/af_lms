// The PMU test set list (#517, ADR 0012): which Papers form each NVS Monthly
// Test, and its name. Server-only. The PMU team keeps the list for Live
// Tracking in Firestore (`pmu_live_tracking_sessions/nvs`, field
// `test_sets: [{label, quiz_ids, current}]`); this is the only module that
// knows that, so a future PMU calendar can replace it behind the same function.
// Read through the Firestore REST API with the BigQuery service account; the
// Firestore SDK is deliberately not a dependency.

import { GoogleAuth } from "google-auth-library";

import type { TestSet } from "@/lib/test-attendance-rules";
import { ttlCache } from "@/lib/ttl-cache";

const DOCUMENT_PATH = "pmu_live_tracking_sessions/nvs";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const READ_TIMEOUT_MS = 10_000;

// Live Tracking accepts the same 5-minute delay. A failed read is not kept.
const cached = ttlCache<TestSet[]>(5 * 60 * 1000, 1);

function googleAuth(): { auth: GoogleAuth; projectId?: string } {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (credentialsJson) {
    // Throws on a value that is not JSON (the e2e server sets " ").
    const credentials = JSON.parse(credentialsJson);
    return {
      auth: new GoogleAuth({ credentials, scopes: [FIRESTORE_SCOPE] }),
      projectId: credentials.project_id,
    };
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      auth: new GoogleAuth({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: [FIRESTORE_SCOPE] }),
    };
  }
  return { auth: new GoogleAuth({ scopes: [FIRESTORE_SCOPE] }) };
}

type FirestoreValue = {
  stringValue?: unknown;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

const asString = (value: FirestoreValue | undefined) =>
  typeof value?.stringValue === "string" ? value.stringValue.trim() : "";

/** Trims labels and quiz ids, de-duplicates ids, drops empty sets; `current` is ignored. */
function parseTestSets(body: unknown): TestSet[] {
  const testSets = (body as { fields?: Record<string, FirestoreValue> } | null)?.fields?.test_sets;
  if (!testSets?.arrayValue || typeof testSets.arrayValue !== "object") {
    throw new Error("test_sets is missing or not a list");
  }
  const sets: TestSet[] = [];
  for (const entry of testSets.arrayValue.values ?? []) {
    const fields = entry?.mapValue?.fields;
    const label = asString(fields?.label);
    const quizIds = [...new Set((fields?.quiz_ids?.arrayValue?.values ?? []).map(asString).filter(Boolean))];
    if (label && quizIds.length > 0) sets.push({ label, quizIds });
  }
  return sets;
}

async function readTestSets(): Promise<TestSet[]> {
  const { auth, projectId: configuredProjectId } = googleAuth();
  const projectId = configuredProjectId || (await auth.getProjectId()) || "avantifellows";
  const token = await auth.getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${DOCUMENT_PATH}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Firestore answered ${response.status}`);
  return parseTestSets(await response.json());
}

/**
 * The NVS test sets as `{label, quizIds}` in list order, or "unavailable"
 * when the list cannot be read. Cached in process for 5 minutes.
 */
export async function getNvsTestSets(): Promise<TestSet[] | "unavailable"> {
  try {
    return await cached("nvs", readTestSets);
  } catch (error) {
    console.error("PMU test set list unavailable:", error instanceof Error ? error.message : "unknown error");
    return "unavailable";
  }
}
