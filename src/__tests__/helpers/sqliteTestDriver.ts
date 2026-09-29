/// <reference types="node" />
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';

/**
 * A real SQLite engine for the local-store tests.
 *
 * D12 chose `expo-sqlite` with real tables and SQL, and justified it entirely on
 * the grounds that the constraints are the enforcement. A test that mocks the
 * database therefore proves nothing: it cannot tell a working foreign key from a
 * missing one. So these tests run actual SQL.
 *
 * `node:sqlite` ships with Node 22 and is the same engine `expo-sqlite` wraps, so
 * a foreign key either fires here or it does not fire on a device. The adapter
 * implements the same four-method surface `expo-sqlite` exposes — `execAsync`,
 * `runAsync`, `getAllAsync`, `getFirstAsync` — which is the port the repository
 * is written against. Nothing in `src/` needs to change to run in this harness.
 *
 * It also records every statement it runs, so a test can assert that a read is
 * one query rather than N.
 */

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

/**
 * Structurally the port the local repository is written against. Parameter types
 * are deliberately `unknown` so this object is assignable to whatever narrower
 * port the implementation declares.
 */
export interface TestSqlDriver {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: unknown[]): Promise<RunResult>;
  getAllAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T | null>;
  closeAsync(): Promise<void>;
}

/** A driver plus the bookkeeping the tests need from it. */
export interface RecordingDriver extends TestSqlDriver {
  /** Every statement run since the last `resetLog()`, in order. */
  readonly statements: readonly string[];
  /** How many times a statement matching `pattern` has run since the last reset. */
  countMatching(pattern: RegExp): number;
  resetLog(): void;
  /** Direct handle, for the few assertions that must bypass the repository. */
  readonly raw: DatabaseSync;
}

const tempDirs: string[] = [];

/** A throwaway file-backed database. File-backed, not `:memory:`, so a reopen is real. */
export function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'packlist-store-'));
  tempDirs.push(dir);
  return join(dir, 'packlist.db');
}

/** Remove every database directory this module created. Call from `afterAll`. */
export function cleanupTempDatabases(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * SQLite's own default. `expo-sqlite` does not turn foreign keys on either, and
 * the option is off by default here so that the only thing enabling enforcement
 * is whatever the store under test does. Without this, the foreign-key tests
 * would pass for the wrong reason.
 */
export function createTestDriver(path: string): RecordingDriver {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const statements: string[] = [];

  // expo-sqlite accepts a single array of anonymous parameters, or named
  // parameters as an object, or plain variadic values. Normalise all three into
  // what `node:sqlite` wants, and map booleans to the 0/1 it stores.
  const bind = (params: unknown[]): SQLInputValue[] => {
    const values = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    if (values.length === 1 && isNamedParams(values[0])) return [values[0]];
    return values.map((value) => {
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (value === undefined) throw new TypeError('undefined cannot be bound');
      if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
        return value;
      }
      if (value instanceof Uint8Array) return value;
      throw new TypeError(`cannot bind ${typeof value}`);
    });
  };

  const driver: RecordingDriver = {
    raw: db,
    statements,

    async execAsync(source: string): Promise<void> {
      statements.push(source);
      db.exec(source);
    },

    async runAsync(source: string, ...params: unknown[]): Promise<RunResult> {
      statements.push(source);
      const result = db.prepare(source).run(...bind(params));
      return {
        changes: Number(result.changes),
        // node:sqlite spells it `lastInsertrowid`; expo spells it `lastInsertRowId`.
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },

    async getAllAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T[]> {
      statements.push(source);
      return db.prepare(source).all(...bind(params)) as T[];
    },

    async getFirstAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T | null> {
      statements.push(source);
      // `getFirstAsync` resolves to null for no row; `node:sqlite` gives undefined.
      return (db.prepare(source).get(...bind(params)) as T | undefined) ?? null;
    },

    async closeAsync(): Promise<void> {
      db.close();
    },

    countMatching(pattern: RegExp): number {
      return statements.filter((statement) => pattern.test(statement)).length;
    },

    resetLog(): void {
      statements.length = 0;
    },
  };

  return driver;
}

function isNamedParams(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => /^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(key));
}
