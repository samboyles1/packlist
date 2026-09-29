import { CATEGORIES } from '@/data/categories';
import { createLocalRepository } from '@/data/localRepository';
import type { LocalRepository } from '@/data/localRepository';

/**
 * The local store: the schema, the migration history, and the narrow SQL port
 * everything above it is written against (D12).
 *
 * The port is the point. `expo-sqlite` supplies it on device; the tests supply
 * `node:sqlite` through the same four calls, so a foreign key that fires in a
 * test fires in the app. Nothing in here imports a SQLite module, which is what
 * lets both exist.
 *
 * The schema is `docs/DATA-MODEL.md` minus `user_id` and everything
 * trip-related. Those arrive with Stage 2's sync, and the local rows are keyed
 * by the same primary keys they will be pushed under.
 */

/** A value SQLite can bind. Booleans are stored as 0/1 by the repository. */
export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

/**
 * The four calls the repository makes, plus close. Deliberately the smallest
 * surface that runs real SQL: no ORM, no query builder, nothing to translate
 * between the local store and Postgres in Stage 2.
 */
export interface SqlDriver {
  /** Runs a script of statements. No parameters, no escaping. */
  execAsync(source: string): Promise<void>;
  /** Runs one statement that writes. */
  runAsync(source: string, ...params: SqlValue[]): Promise<RunResult>;
  getAllAsync<T = unknown>(source: string, ...params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T = unknown>(source: string, ...params: SqlValue[]): Promise<T | null>;
  closeAsync(): Promise<void>;
}

/** One numbered, additive step. A migration is never edited once shipped. */
export interface Migration {
  readonly version: number;
  up(driver: SqlDriver): Promise<void>;
}

/**
 * The owner stamped on every local row.
 *
 * Stage 1 has no accounts, and the local tables have no `user_id` column to put
 * one in. The domain types still carry a `userId`, so a row gets the nil UUID:
 * a real uuid, which means these rows can be pushed under their own primary
 * keys before Stage 2 exists, and be reconciled with a real owner after.
 */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000000';

const CREATE_MIGRATIONS_TABLE = `
create table if not exists schema_migrations (
  version    integer primary key not null,
  applied_at text not null
);`;

const CREATE_SCHEMA = `
create table categories (
  id         text    primary key not null,
  name       text    not null,
  sort_order integer not null
);

create table items (
  id                text    primary key not null,
  category_id       text    not null references categories (id),
  brand             text,
  name              text    not null,
  weight_grams      integer not null default 0 check (weight_grams >= 0),
  is_consumable     integer not null default 0 check (is_consumable in (0, 1)),
  pack_weight_grams integer check (pack_weight_grams is null or pack_weight_grams >= 0),
  units_per_pack    integer check (units_per_pack is null or units_per_pack > 0),
  is_worn           integer not null default 0 check (is_worn in (0, 1)),
  litre_volume      numeric(6, 2) check (litre_volume is null or litre_volume >= 0),
  must_have         integer not null default 0 check (must_have in (0, 1)),
  created_at        text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table item_links (
  item_id        text not null references items (id) on delete cascade,
  linked_item_id text not null references items (id) on delete cascade,
  primary key (item_id, linked_item_id),
  check (item_id <> linked_item_id)
);

create table packs (
  id           text    primary key not null,
  name         text    not null,
  type         text,
  weight_grams integer check (weight_grams is null or weight_grams >= 0),
  litre_volume numeric(6, 2) check (litre_volume is null or litre_volume >= 0),
  created_at   text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table pack_items (
  id       text    primary key not null,
  pack_id  text    not null references packs (id) on delete cascade,
  item_id  text    not null references items (id) on delete cascade,
  qty      integer not null default 1 check (qty > 0),
  ticked   integer not null default 0 check (ticked in (0, 1)),
  position integer not null default 0,
  unique (pack_id, item_id)
);

create index items_category_idx on items (category_id, name);
create index pack_items_pack_idx on pack_items (pack_id, position);
`;

/**
 * The migration history, oldest first.
 *
 * The categories are seeded as their own version rather than as part of the
 * schema, so a later taxonomy change is another migration and not a silent
 * divergence between installs. `insert or ignore` keeps a reinstall from
 * duplicating rows it already has.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: async (driver) => {
      await driver.execAsync(CREATE_SCHEMA);
    },
  },
  {
    version: 2,
    up: async (driver) => {
      for (const category of CATEGORIES) {
        await driver.runAsync(
          'insert or ignore into categories (id, name, sort_order) values (?, ?, ?)',
          category.id,
          category.name,
          category.sortOrder,
        );
      }
    },
  },
];

export interface OpenLocalDatabaseOptions {
  /**
   * The connection to run on. Injected so tests can use `node:sqlite`.
   *
   * Ownership passes to `openLocalDatabase` only until it returns: if a
   * migration fails, the failed connection is closed before the error
   * propagates, because the caller is never handed a store to close it with.
   */
  driver: SqlDriver;
  /** Defaults to the store's own `MIGRATIONS`. */
  migrations?: readonly Migration[];
}

export interface LocalStore {
  driver: SqlDriver;
  repository: LocalRepository;
  close(): Promise<void>;
}

/**
 * Open a local store on an existing connection and bring its schema up to date.
 *
 * The connection is expected to be usable but otherwise untouched: everything
 * that has to be true before a single migration runs is done here.
 */
export async function openLocalDatabase(
  options: OpenLocalDatabaseOptions,
): Promise<LocalStore> {
  const { driver, migrations = MIGRATIONS } = options;
  assertDistinctVersions(migrations);

  // Per connection, and outside every transaction, because SQLite ignores the
  // pragma inside one. It ships off, so without this the constraints above are
  // silently inert and every test that relies on them passes for the wrong
  // reason (D12).
  await driver.execAsync('PRAGMA foreign_keys = ON');

  try {
    await migrate(driver, migrations);
  } catch (error) {
    // A store that failed to open hands the caller nothing, so it must not
    // leave a connection behind either. The migration error is the one worth
    // reporting.
    await driver.closeAsync().catch(() => undefined);
    throw error;
  }

  return {
    driver,
    repository: createLocalRepository(driver, LOCAL_USER_ID),
    close: () => driver.closeAsync(),
  };
}

function assertDistinctVersions(migrations: readonly Migration[]): void {
  const seen = new Set<number>();

  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`two migrations claim version ${migration.version}`);
    }
    seen.add(migration.version);
  }
}

/**
 * Bring a database up to the latest version.
 *
 * Each pending migration runs in its own transaction, and its version is
 * recorded inside that same transaction, after it has run. So a migration that
 * fails halfway leaves neither the schema it was building nor a version saying
 * it applied, and the next open retries exactly that one.
 */
async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[],
): Promise<void> {
  await driver.execAsync(CREATE_MIGRATIONS_TABLE);
  const applied = new Set(
    (
      await driver.getAllAsync<{ version: number }>(
        'select version from schema_migrations order by version',
      )
    ).map((row) => row.version),
  );

  const pending = [...migrations]
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await driver.execAsync('begin');

    try {
      await migration.up(driver);
      await driver.runAsync(
        "insert into schema_migrations (version, applied_at) values (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        migration.version,
      );
      await driver.execAsync('commit');
    } catch (error) {
      await driver.execAsync('rollback');
      throw error;
    }
  }
}
