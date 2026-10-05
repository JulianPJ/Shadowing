import { emptySync, syncCollections, type SyncData } from './types';
import { validateSync } from './validation';
// A corrupt/private local record cannot prevent the rest of a device import or leak extra fields.
export function sanitizeDeviceData(value: unknown): SyncData {
  const result = emptySync();
  if (!value || typeof value !== 'object') return result;
  const data = value as Record<string, unknown>;
  try {
    result.preferences = validateSync({
      ...emptySync(),
      preferences: data.preferences ?? null,
    }).preferences;
  } catch {
    /* Ignore corrupt preferences. */
  }
  for (const kind of syncCollections) {
    if (!Array.isArray(data[kind])) continue;
    const items = [];
    for (const row of data[kind]) {
      try {
        items.push(...validateSync({ ...emptySync(), [kind]: [row] })[kind]);
      } catch {
        /* Isolate unsafe records before sending any request. */
      }
    }
    Object.assign(result, { [kind]: items });
  }
  return result;
}
