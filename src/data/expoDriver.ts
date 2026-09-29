import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openLocalDatabase } from '@/data/db';
import type {
  LocalStore,
  OpenLocalDatabaseOptions,
  SqlDriver,
  SqlValue,
} from '@/data/db';

/**
 * The device side of the store: `expo-sqlite` wrapped as the port the
 * repository is written against (D12).
 *
 * This is the only file that imports `expo-sqlite`. The repository and the
 * migration runner speak `SqlDriver`, so the same SQL runs on a real
 * `SQLiteDatabase` on a phone and on `node:sqlite` in a test, and neither side
 * needs to know about the other.
 */

const DATABASE_NAME = 'packlist.db';

/**
 * `expo-sqlite` takes its parameters as an array or as variadic arguments; the
 * port is variadic, because that is the only form both engines accept. Booleans
 * are already `0`/`1` by the time they reach here.
 */
export function createExpoDriver(database: SQLiteDatabase): SqlDriver {
  return {
    execAsync: (source) => database.execAsync(source),
    runAsync: (source, ...params: SqlValue[]) => database.runAsync(source, params),
    getAllAsync: <T>(source: string, ...params: SqlValue[]) =>
      database.getAllAsync<T>(source, params),
    getFirstAsync: <T>(source: string, ...params: SqlValue[]) =>
      database.getFirstAsync<T>(source, params),
    closeAsync: () => database.closeAsync(),
  };
}

/**
 * Open the app's own database file and bring its schema up to date.
 *
 * The connection is opened here and handed to `openLocalDatabase`, which is
 * what turns on foreign keys and runs the migrations before anything reads a
 * row. The driver is not a parameter: this is the one place that decides which
 * engine the app runs on.
 */
export async function openLocalStore(
  options: { migrations?: OpenLocalDatabaseOptions['migrations'] } = {},
): Promise<LocalStore> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  return openLocalDatabase({ ...options, driver: createExpoDriver(database) });
}
