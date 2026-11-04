import initSqlJs from 'sql.js';
import { zstdCompressSync } from 'node:zlib';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

/** Synthetic fixtures following Anki schema 11/18, not copied learner data. */
export async function ankiFixture(
  format: 'legacy' | 'legacy21' | 'current' = 'current',
  count = 3,
  scheduling = true,
) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const models = {
    10: {
      name: 'Japanese sentences',
      flds: ['VocabKanji', 'VocabFurigana', 'VocabDef', 'SentKanji', 'SentEng'].map(
        (name, ord) => ({ name, ord }),
      ),
    },
    20: {
      name: 'Lapis',
      flds: ['Expression', 'ExpressionReading', 'MainDefinition', 'Sentence'].map((name, ord) => ({
        name,
        ord,
      })),
    },
  };
  const decks = { 1: { name: 'Japanese' }, 2: { name: 'Japanese::Daily' } };
  db.run(
    'CREATE TABLE col(models TEXT,decks TEXT); CREATE TABLE notes(id INTEGER PRIMARY KEY,mid INTEGER,flds TEXT); CREATE TABLE cards(nid INTEGER,did INTEGER,odid INTEGER,type INTEGER,queue INTEGER,ivl INTEGER);',
  );
  db.run('INSERT INTO col VALUES (?,?)', [JSON.stringify(models), JSON.stringify(decks)]);
  if (format === 'current') {
    db.run(
      'CREATE TABLE notetypes(id INTEGER PRIMARY KEY,name TEXT COLLATE NOCASE); CREATE TABLE fields(ntid INTEGER NOT NULL,ord INTEGER NOT NULL,name TEXT NOT NULL COLLATE NOCASE,PRIMARY KEY(ntid,ord)) WITHOUT ROWID; CREATE UNIQUE INDEX idx_fields_name_ntid ON fields(name,ntid); CREATE TABLE decks(id INTEGER PRIMARY KEY,name TEXT COLLATE NOCASE);',
    );
    for (const [id, m] of Object.entries(models)) {
      db.run('INSERT INTO notetypes VALUES (?,?)', [Number(id), m.name]);
      m.flds.forEach((f) =>
        db.run('INSERT INTO fields VALUES (?,?,?)', [Number(id), f.ord, f.name]),
      );
    }
    for (const [id, d] of Object.entries(decks))
      db.run('INSERT INTO decks VALUES (?,?)', [Number(id), d.name.replaceAll('::', '\u001f')]);
    // Real modern files name this Anki-specific collation, even when the import does no comparisons on it.
    db.run(
      "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql,'COLLATE NOCASE','COLLATE unicase') WHERE name IN ('decks','notetypes','fields'); PRAGMA writable_schema=OFF;",
    );
  }
  for (let i = 0; i < count; i++) {
    db.run('INSERT INTO notes VALUES (?,?,?)', [
      i + 1,
      i === 1 ? 20 : 10,
      [
        i === 0 ? '猫' : i === 1 ? '橋' : `語${i}`,
        'ねこ',
        '<b>cat</b><script>throw 1</script>',
        '猫です。',
        'A cat.',
      ].join('\u001f'),
    ]);
    db.run('INSERT INTO cards VALUES (?,?,?,?,?,?)', [
      i + 1,
      i === 1 ? 2 : 1,
      0,
      !scheduling || i === 2 ? 0 : 2,
      !scheduling || i === 2 ? 0 : 2,
      !scheduling ? 0 : i === 0 ? 30 : i === 1 ? 21 : 0,
    ]);
  }
  db.run(
    `INSERT INTO cards VALUES (1,2,0,${scheduling ? 2 : 0},${scheduling ? 2 : 0},${scheduling ? 10 : 0})`,
  );
  const bytes = db.export();
  db.close();
  const zip = new ZipWriter(new BlobWriter('application/octet-stream'), { useWebWorkers: false });
  const filename =
    format === 'current'
      ? 'collection.anki21b'
      : format === 'legacy21'
        ? 'collection.anki21'
        : 'collection.anki2';
  await zip.add(
    filename,
    new BlobReader(
      new Blob([new Uint8Array(format === 'current' ? zstdCompressSync(bytes) : bytes)]),
    ),
  );
  await zip.add('0', new TextReader('media is never extracted'));
  await zip.add('media', new TextReader('{"0":"sound.mp3"}'));
  if (format === 'current')
    await zip.add('meta', new BlobReader(new Blob([new Uint8Array([8, 3])])));
  return await zip.close();
}
