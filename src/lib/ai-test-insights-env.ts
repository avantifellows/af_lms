// AI Test Insights (#550): the settings and log helpers both server sides
// share, the delivery to AI Mentorship Guide and the artifact reader, so a
// new environment or a settings rule changes in one place. Server-only: it
// reads `process.env`.

/** The environments AI Mentorship Guide keeps apart: the `environment` of an enqueue, the folder of a file. */
export type AiTestInsightsEnvironment = "staging" | "production";

/** A setting's value, trimmed; a blank after trimming counts as unset. */
export function aiTestInsightsSetting(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** `APP_ENV` when it is `staging` or `production`; null otherwise, which leaves both sides unconfigured. */
export function aiTestInsightsEnvironment(): AiTestInsightsEnvironment | null {
  const environment = aiTestInsightsSetting("APP_ENV");
  return environment === "staging" || environment === "production" ? environment : null;
}

/** An error's name for a log line, never its message: a database or store message can quote values. */
export function errorName(error: unknown, fallback = "unknown"): string {
  return error instanceof Error ? error.name : fallback;
}
