// A small in-process cache for slow reads whose source changes rarely (the
// warehouse changes only when the ETL runs). Per server instance: a cold
// instance simply reads again. Concurrent callers share one in-flight read,
// and a failed read is not kept.

interface Entry<T> {
  value: Promise<T>;
  expires: number;
}

export function ttlCache<T>(ttlMs: number, maxEntries = 500) {
  const entries = new Map<string, Entry<T>>();
  return function cached(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expires > now) return hit.value;
    if (hit) entries.delete(key);
    const value = load();
    entries.set(key, { value, expires: now + ttlMs });
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    // Map keeps insertion order, so the first key is the oldest.
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return value;
  };
}
