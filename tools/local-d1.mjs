import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function localD1(filename = ':memory:', { initialize = true } = {}) {
  const database = new DatabaseSync(filename);
  if (initialize) database.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

  function prepare(sql, values = []) {
    const statement = () => database.prepare(sql);
    return {
      bind: (...bound) => prepare(sql, bound),
      first: async () => statement().get(...values) ?? null,
      all: async () => ({ results: statement().all(...values) }),
      run: async () => statement().run(...values),
      execute: () => sql.startsWith('SELECT') || /\bRETURNING\b/i.test(sql)
        ? { results: statement().all(...values) }
        : statement().run(...values)
    };
  }

  return {
    prepare,
    close: () => database.close(),
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
