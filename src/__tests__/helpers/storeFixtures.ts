/// <reference types="node" />
import { existsSync } from 'node:fs';

import { openLocalDatabase, type Migration } from '@/data/db';
import type { LocalRepository, NewItem, NewPack } from '@/data/localRepository';
import type { GearItem } from '@/types/gear';

import {
  cleanupTempDatabases,
  createTestDriver,
  tempDatabasePath,
} from './sqliteTestDriver';
import type { RecordingDriver } from './sqliteTestDriver';

/**
 * Shared setup for the S1-02 local-store tests: one factory per thing, a
 * throwaway file-backed database per test, and no state shared between tests.
 *
 * The database is a real SQLite file, driven through the store's own port, so
 * the constraints under test are enforced by SQLite rather than asserted about.
 */

/**
 * The artifact's own figures, reused from `src/__tests__/weights.test.ts` so the
 * two files cannot quietly disagree about what "the rifle" weighs.
 */
export const ARTIFACT = {
  bag: { name: 'Stone Glacier Sky Talus 6900', weightGrams: 2400, litreVolume: 113 },
  rifle: { name: 'Tikka T3x Lite', weightGrams: 2900 },
  scope: { name: 'Leupold VX-5HD', weightGrams: 561 },
  rings: { name: 'Talley Lightweight', weightGrams: 57 },
  bipod: { name: 'Javelin Pro', weightGrams: 230 },
  /** 20 rounds to a box, 26 g a round — the "7mm-08 Rem 140gr — 26 g ea." row. */
  ammo: { name: '7mm-08 Rem 140gr', packWeightGrams: 520, unitsPerPack: 20 },
  /** The artifact's "Clif Chocolate Chip — 68 g ea." */
  bar: { name: 'Clif Chocolate Chip', weightGrams: 68 },
  jacket: { name: 'Torrentshell 3L', weightGrams: 290 },
  boots: { name: 'Hiking boots', weightGrams: 2100 },
  meals: { name: 'Freeze-dried dinners', weightGrams: 190 },
} as const;

/** An item as the catalogue screen would submit it, before the store fills in ids. */
export function newItem(overrides: Partial<NewItem> = {}): NewItem {
  return {
    categoryId: 'accessory',
    brand: null,
    name: 'Unnamed item',
    weightGrams: 0,
    isConsumable: false,
    packWeightGrams: null,
    unitsPerPack: null,
    isWorn: false,
    litreVolume: null,
    mustHave: false,
    ...overrides,
  };
}

/** A pack as the pack form would submit it, before the store fills in ids. */
export function newPack(overrides: Partial<NewPack> = {}): NewPack {
  return {
    name: 'Hunting Pack',
    type: 'Hunting Pack',
    weightGrams: 0,
    litreVolume: null,
    ...overrides,
  };
}

export interface TestStore {
  driver: RecordingDriver;
  repository: LocalRepository;
  path: string;
  close(): Promise<void>;
}

export interface OpenStoreOptions {
  /** Defaults to the store's own migration list. */
  migrations?: readonly Migration[];
  /** Reuse a path to reopen an existing database. */
  path?: string;
}

/** Open a real SQLite database through the store under test, with real SQL. */
export async function openTestStore(options: OpenStoreOptions = {}): Promise<TestStore> {
  const path = options.path ?? tempDatabasePath();
  const driver = createTestDriver(path);
  const store = await openLocalDatabase({
    driver,
    ...(options.migrations !== undefined ? { migrations: options.migrations } : {}),
  });

  return {
    driver,
    repository: store.repository,
    path,
    close: () => store.close(),
  };
}

/** Call from `afterAll` in any file that opened test databases. */
export function cleanup(): void {
  cleanupTempDatabases();
}

/** A path for a database nobody has opened yet. */
export { tempDatabasePath };

/** Proves the database is a file on disk, not an in-memory stand-in. */
export function databaseFileExists(path: string): boolean {
  return existsSync(path);
}

/** A migration that records itself, so a test can see which ones actually ran. */
export function spyMigration(version: number, sql: string, log: number[]): Migration {
  return {
    version,
    up: async (driver) => {
      await driver.execAsync(sql);
      log.push(version);
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { GearItem, LocalRepository, Migration };
