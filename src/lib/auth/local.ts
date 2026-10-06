// Standard Next.js development uses a durable local SQLite DB. Production uses native D1.
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createAuth, authEnvironment } from './server';
import { createD1UserProgressRepository } from '../sync/repository';
import { localProgressDatabase } from '../sync/local-database';
import { createD1DictionaryRepository } from '../dictionary/repository';
import { createD1AccessRepository } from '../access';

let local:
  | Promise<{
      auth: ReturnType<typeof createAuth>;
      repository: ReturnType<typeof createD1UserProgressRepository>;
      dictionary: ReturnType<typeof createD1DictionaryRepository>;
      access: ReturnType<typeof createD1AccessRepository>;
    } | null>
  | undefined;
export function localAuth() {
  local ??= (async () => {
    if (!process.env.AUTH_SECRET || !process.env.AUTH_BASE_URL) return null;
    const moduleName = 'node:sqlite';
    const { DatabaseSync } = (await import(
      /* webpackIgnore: true */ /* @vite-ignore */ moduleName
    )) as typeof import('node:sqlite');
    await mkdir('.cloudflare', { recursive: true });
    const db = new DatabaseSync(path.resolve('.cloudflare/next-auth.sqlite'));
    db.exec(
      'PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS local_auth_migrations (name TEXT PRIMARY KEY);',
    );
    for (const file of (await readdir('migrations'))
      .sort()
      .filter((x) => /^\d{4}_.+\.sql$/.test(x) && Number(x.slice(0, 4)) >= 2)) {
      if (db.prepare('SELECT name FROM local_auth_migrations WHERE name=?').get(file)) continue;
      db.exec(await readFile(path.join('migrations', file), 'utf8'));
      db.prepare('INSERT INTO local_auth_migrations VALUES (?)').run(file);
    }
    const database = localProgressDatabase(db);
    return {
      auth: createAuth(db, authEnvironment()),
      repository: createD1UserProgressRepository(database),
      dictionary: createD1DictionaryRepository(database),
      access: createD1AccessRepository(database),
    };
  })();
  return local;
}
