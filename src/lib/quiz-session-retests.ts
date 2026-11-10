// Which quiz sessions are retests: the creator's answer to "Have these students already
// taken this paper?", stored as session meta_data.is_retest (LMS / Session Manager).
// The warehouse keeps these sessions out of the Academic Level (dim_session.session_is_retest);
// the Score journey greys them, so both read the same flag. Read live from Postgres, so a
// flag set or cleared in the Edit dialog shows at once rather than after the warehouse sync.
import { query } from "./db";

export async function getRetestSessionIds(sessionIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const rows = await query<{ session_id: string }>(
    `SELECT session_id
       FROM session
      WHERE session_id = ANY($1)
        AND meta_data->>'is_retest' = 'true'`,
    [ids]
  );
  return new Set(rows.map((r) => r.session_id));
}
