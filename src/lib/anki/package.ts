import { BlobReader, ZipReader, type Entry } from '@zip.js/zip.js';
import { Decompress } from 'fzstd';
import type { SqlJsStatic } from 'sql.js';
import type { AnkiModel, AnkiNote, AnkiPackage } from './types';

export const PACKAGE_LIMIT = 128 * 1024 * 1024;
export const COLLECTION_LIMIT = 64 * 1024 * 1024;
export const NOTE_LIMIT = 50000;

export function expandZstd(input: Uint8Array) {
  // Inspect every frame before the decoder allocates its window. Output limits alone
  // cannot stop a malicious frame header requesting gigabytes of working memory.
  let frame = 0;
  while (frame < input.length) {
    if (
      input.length - frame < 6 ||
      input[frame] !== 0x28 ||
      input[frame + 1] !== 0xb5 ||
      input[frame + 2] !== 0x2f ||
      input[frame + 3] !== 0xfd
    )
      throw new Error('Unsupported Zstandard frame.');
    const flag = input[frame + 4],
      single = !!(flag & 32),
      sizeFlag = flag >>> 6;
    if (flag & 24) throw new Error('Invalid Zstandard frame.');
    let pos = frame + 5;
    let window = 0;
    if (!single) {
      const descriptor = input[pos++];
      const base = 2 ** (10 + (descriptor >>> 3));
      window = base + (base / 8) * (descriptor & 7);
    }
    const dictSize = [0, 1, 2, 4][flag & 3];
    pos += dictSize;
    const sizeBytes = sizeFlag ? 2 ** sizeFlag : single ? 1 : 0;
    if (pos + sizeBytes > input.length) throw new Error('Truncated frame.');
    let content = 0;
    for (let i = 0; i < sizeBytes; i++) content += input[pos + i] * 2 ** (8 * i);
    if (sizeFlag === 1) content += 256;
    pos += sizeBytes;
    if (single) window = content;
    if (content > COLLECTION_LIMIT || window > COLLECTION_LIMIT)
      throw new Error('Collection exceeds the 64 MiB expanded limit.');
    let last = false;
    while (!last) {
      if (pos + 3 > input.length) throw new Error('Truncated block.');
      const header = input[pos] + input[pos + 1] * 256 + input[pos + 2] * 65536;
      pos += 3;
      last = !!(header & 1);
      const type = (header >>> 1) & 3;
      if (type === 3) throw new Error('Invalid block.');
      pos += type === 1 ? 1 : header >>> 3;
      if (pos > input.length) throw new Error('Truncated block.');
    }
    if (flag & 4) pos += 4;
    if (pos > input.length) throw new Error('Truncated checksum.');
    frame = pos;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stream = new Decompress((chunk) => {
    size += chunk.length;
    if (size > COLLECTION_LIMIT)
      throw new Error('Collection exceeds the 64 MiB expanded limit. Export a smaller deck.');
    chunks.push(chunk.slice());
  });
  for (let offset = 0; offset < input.length; offset += 65536)
    stream.push(input.subarray(offset, offset + 65536), offset + 65536 >= input.length);
  const output = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.length;
  }
  return output;
}

export function readCollection(
  SQL: SqlJsStatic,
  bytes: Uint8Array,
  format: string,
  media: boolean,
): AnkiPackage {
  const db = new SQL.Database(bytes);
  try {
    // sql.js has no Anki `unicase` collation. In modern WITHOUT ROWID fields
    // tables, even a scan fails without it. Adapt only the private in-memory
    // metadata schema; the package bytes and stored text are never changed.
    // We scan these tables without secondary indexes and only order numeric
    // IDs/ordinals, so Anki's name comparison rules are not needed here.
    db.run(`
      PRAGMA trusted_schema=OFF;
      PRAGMA writable_schema=ON;
      UPDATE sqlite_schema SET sql=replace(sql,'COLLATE unicase','COLLATE BINARY')
        WHERE type='table' AND name IN ('fields','notetypes','decks');
      PRAGMA writable_schema=RESET;
      PRAGMA query_only=ON;
    `);
    const rows = (sql: string) => {
      const statement = db.prepare(sql);
      const out: Record<string, unknown>[] = [];
      try {
        while (statement.step()) {
          out.push(statement.getAsObject());
          if (out.length > NOTE_LIMIT * 4)
            throw new Error('Too many cards. Export a smaller deck.');
        }
      } finally {
        statement.free();
      }
      return out;
    };
    // Never query views, triggers or arbitrary identifiers supplied by the package.
    const tables = new Set(
      rows("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name),
    );
    if (!['col', 'notes', 'cards'].every((t) => tables.has(t)))
      throw new Error('Unsupported Anki database.');
    const col = rows('SELECT models,decks FROM col LIMIT 1')[0];
    if (!col) throw new Error('Missing collection metadata.');
    let models: AnkiModel[];
    const decks = new Map<string, string>();
    if (tables.has('notetypes') && tables.has('fields') && tables.has('decks')) {
      const fields = rows('SELECT ntid,ord,name FROM fields NOT INDEXED ORDER BY ntid,ord');
      models = rows('SELECT id,name FROM notetypes NOT INDEXED').map((r) => ({
        id: String(r.id),
        name: String(r.name),
        fields: fields.filter((f) => f.ntid === r.id).map((f) => String(f.name)),
      }));
      for (const d of rows('SELECT id,name FROM decks NOT INDEXED'))
        decks.set(String(d.id), String(d.name).replace(/\u001f/g, '::'));
    } else {
      const legacyModels = JSON.parse(String(col.models)) as Record<
        string,
        { name: string; flds: { name: string; ord: number }[] }
      >;
      models = Object.entries(legacyModels).map(([id, m]) => ({
        id,
        name: m.name,
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      }));
      for (const [id, d] of Object.entries(
        JSON.parse(String(col.decks)) as Record<string, { name: string }>,
      ))
        decks.set(id, d.name);
    }
    if (models.length > 100 || decks.size > 1000 || models.some((m) => m.fields.length > 100))
      throw new Error('Too many note types, fields or decks. Export a smaller deck.');
    const notes = new Map<string, AnkiNote>();
    for (const n of rows(`SELECT id,mid,flds FROM notes LIMIT ${NOTE_LIMIT + 1}`)) {
      if (notes.size >= NOTE_LIMIT)
        throw new Error('More than 50,000 notes. Export a smaller deck.');
      notes.set(String(n.id), {
        id: String(n.id),
        model: String(n.mid),
        fields: String(n.flds).split('\u001f'),
        cards: [],
      });
    }
    let scheduling = false;
    for (const c of rows(
      `SELECT nid,did,odid,type,queue,ivl FROM cards LIMIT ${NOTE_LIMIT * 4 + 1}`,
    )) {
      const deck = decks.get(String(Number(c.odid) > 0 ? c.odid : c.did));
      if (!deck) continue;
      const interval =
        Number(c.type) === 2 &&
        Number(c.queue) !== 1 &&
        Number(c.queue) !== 3 &&
        Number.isFinite(c.ivl) &&
        Number(c.ivl) > 0
          ? Number(c.ivl)
          : null;
      if (interval !== null) scheduling = true;
      notes.get(String(c.nid))?.cards.push({ deck, interval });
    }
    return {
      models,
      decks: [...decks.values()].sort(),
      notes: [...notes.values()],
      media,
      format,
      scheduling,
    };
  } finally {
    db.close();
  }
}

export async function parsePackage(file: Blob, SQL: SqlJsStatic): Promise<AnkiPackage> {
  if (file.size > PACKAGE_LIMIT)
    throw new Error('Package exceeds 128 MiB. Export a smaller deck without media.');
  const zip = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    const entries: Entry[] = [];
    for await (const e of zip.getEntriesGenerator()) {
      entries.push(e);
      if (entries.length > 100000) throw new Error('Too many archive entries.');
    }
    const names = ['collection.anki2', 'collection.anki21', 'collection.anki21b'];
    const meta = entries.find((e) => e.filename === 'meta');
    let filename = entries.some((e) => e.filename === 'collection.anki21')
      ? 'collection.anki21'
      : 'collection.anki2';
    if (meta && !meta.directory) {
      if (meta.encrypted || meta.uncompressedSize !== 2)
        throw new Error('Unsupported package metadata.');
      const bytes = new Uint8Array(2);
      let used = 0;
      await meta.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            if (used + chunk.length > 2) throw new Error('Oversized package metadata.');
            bytes.set(chunk, used);
            used += chunk.length;
          },
        }),
        { checkSignature: true },
      );
      if (used !== 2 || bytes[0] !== 8 || ![1, 2, 3].includes(bytes[1]))
        throw new Error('Unsupported package version.');
      filename = names[bytes[1] - 1];
    }
    if (
      entries.filter((e) => e.filename === filename).length !== 1 ||
      entries.filter((e) => e.filename === 'meta').length > 1
    )
      throw new Error('Ambiguous package contents.');
    const collection = entries.find((e) => e.filename === filename);
    if (
      !collection ||
      collection.directory ||
      collection.encrypted ||
      collection.uncompressedSize > COLLECTION_LIMIT
    )
      throw new Error('Missing, encrypted or oversized Anki collection.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    await collection.getData(
      new WritableStream<Uint8Array>({
        write(chunk) {
          size += chunk.length;
          if (size > COLLECTION_LIMIT) throw new Error('Expanded collection is too large.');
          chunks.push(chunk.slice());
        },
      }),
      { checkSignature: true },
    );
    const data = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      data.set(c, at);
      at += c.length;
    }
    const bytes = collection.filename === 'collection.anki21b' ? expandZstd(data) : data;
    return readCollection(
      SQL,
      bytes,
      collection.filename,
      entries.some((e) => /^\d+$/.test(e.filename)),
    );
  } finally {
    await zip.close();
  }
}
