export interface DbServiceConfig {
  baseUrl: string;
  headers: {
    "Content-Type": "application/json";
    Authorization: string;
  };
}

export function getDbServiceConfig(): DbServiceConfig | null {
  const baseUrl = process.env.DB_SERVICE_URL?.replace(/\/+$/, "");
  const token = process.env.DB_SERVICE_TOKEN;
  if (!baseUrl || !token) return null;

  return {
    baseUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
}
