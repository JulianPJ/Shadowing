import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { ProgressDatabase, ProgressStatement } from './repository';
// Local development only; application SQL is identical to the D1 repository.
export function localProgressDatabase(db: DatabaseSync): ProgressDatabase {
  class Statement implements ProgressStatement {
    constructor(
      readonly sql: string,
      readonly values: SQLInputValue[] = [],
    ) {}
    bind(...values: (string | number | null)[]) {
      return new Statement(this.sql, values);
    }
    async first<T>() {
      return (db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
    }
    async all<T>() {
      return { results: db.prepare(this.sql).all(...this.values) as T[] };
    }
  }
  return {
    prepare(sql) {
      return new Statement(sql);
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const result = statements.map((s) => {
          if (!(s instanceof Statement)) throw new Error('Invalid statement');
          return db.prepare(s.sql).run(...s.values);
        });
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
