import type { D1Database } from '@cloudflare/workers-types';
export type { D1Database };

// Diagnostics deliberately contain no exception message, URL, text or payload.
export function storageEvent(event: string, artifactType?: string) {
  console.info(JSON.stringify({ event, ...(artifactType ? { artifactType } : {}) }));
}
export async function storageFallback<T>(event: string, fallback: T, operation: () => Promise<T>, artifactType?: string): Promise<T> {
  try { return await operation(); }
  catch { storageEvent(event, artifactType); return fallback; }
}
