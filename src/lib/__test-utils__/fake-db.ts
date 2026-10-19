// A scripted stand-in for `query()` / `withTransaction()` in server-module tests. Each handler
// matches a SQL fragment and returns rows; every call is recorded so tests can assert what was
// (and was not) written. Unmatched SQL returns no rows.

export interface FakeDbCall {
  sql: string;
  params: unknown[];
}

type Rows = Record<string, unknown>[];
type Handler = [match: string | RegExp, rows: Rows | ((params: unknown[]) => Rows)];

export function createFakeDb(handlers: Handler[] = []) {
  const calls: FakeDbCall[] = [];
  const routes = [...handlers];

  async function run(sql: string, params: unknown[] = []): Promise<Rows> {
    calls.push({ sql, params });
    const handler = routes.find(([match]) =>
      typeof match === "string" ? sql.includes(match) : match.test(sql)
    );
    if (!handler) return [];
    const [, rows] = handler;
    return typeof rows === "function" ? rows(params) : rows;
  }

  // One entry per withTransaction call: committed, or rolled back by a thrown error.
  const transactions: Array<"committed" | "rolled back"> = [];

  return {
    calls,
    transactions,
    // Handlers added later win over earlier ones.
    on(match: string | RegExp, rows: Rows | ((params: unknown[]) => Rows)) {
      routes.unshift([match, rows]);
    },
    query: (sql: string, params?: unknown[]) => run(sql, params),
    async withTransaction<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
      try {
        const result = await fn({
          query: async (sql: string, params?: unknown[]) => ({ rows: await run(sql, params) }),
        });
        transactions.push("committed");
        return result;
      } catch (error) {
        transactions.push("rolled back");
        throw error;
      }
    },
    sqlCalls: (match: string) => calls.filter((call) => call.sql.includes(match)),
  };
}
