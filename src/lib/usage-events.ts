import { query } from "./db";

export type UsageEvent = "sign_in" | "combined_report_requested" | "tab_viewed";

// Best-effort product-usage log (lms_usage_events). Never throws: tracking must not
// break the action being tracked. Role defaults to the email's user_permission role.
export async function recordUsageEvent(input: {
  event: UsageEvent;
  email: string;
  role?: string | null;
  schoolCode?: string | null;
  centreId?: number | null;
  detail?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO lms_usage_events (event, email, role, school_code, centre_id, detail, meta)
       VALUES (
         $1, $2,
         COALESCE($3, (SELECT role FROM user_permission
                       WHERE LOWER(email) = LOWER($2) AND revoked_at IS NULL LIMIT 1)),
         $4, $5, $6, $7
       )
       ON CONFLICT DO NOTHING`,
      [
        input.event,
        input.email,
        input.role ?? null,
        input.schoolCode ?? null,
        input.centreId ?? null,
        input.detail ?? null,
        JSON.stringify(input.meta ?? {}),
      ]
    );
  } catch (error) {
    console.error("Failed to record usage event:", input.event, error);
  }
}
