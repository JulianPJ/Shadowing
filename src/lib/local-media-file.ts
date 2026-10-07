// Bounded handles only: do not fetch or buffer a large object URL to recover its source File.
// These references never enter localStorage, D1 or account sync.
const files = new Map<string, File>();

export function localMediaUrl(file: File) {
  const url = URL.createObjectURL(file);
  files.set(url, file);
  while (files.size > 8) files.delete(files.keys().next().value!);
  return url;
}

export function localMediaFile(url?: string) {
  return url ? files.get(url) : undefined;
}
