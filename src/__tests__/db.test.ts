/// <reference types="node" />
import { CATEGORIES, SORTED_CATEGORIES } from '@/data/categories';
import { MIGRATIONS, openLocalDatabase } from '@/data/db';
import type { SqlDriver } from '@/data/db';

import { createTestDriver } from './helpers/sqliteTestDriver';
import {
  cleanup,
  databaseFileExists,
  newItem,
  newPack,
  openTestStore,
  spyMigration,
  tempDatabasePath,
} from './helpers/storeFixtures';
import type { TestStore } from './helpers/storeFixtures';

/**
 * S1-02 — the local store's schema, its migration history, and the constraints
 * that make it a database rather than a bag of JSON (D12).
 *
 * These tests run real SQL through `node:sqlite`, so a foreign key either fires
 * here or it does not fire on a device. The alternative — asserting that a mock
 * was called with the right SQL — would pass against an implementation with no
 * foreign key at all, which is the exact failure D12 exists to prevent.
 *
 * The column names below come straight from `docs/DATA-MODEL.md`, which D12 makes
 * authoritative for the local schema minus `user_id` and everything trip-related.
 */

const PACK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PACK_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LINKED_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const UNRELATED_ITEM_ID = '55555555-5555-4555-8555-555555555555';

const insertItem = (
  id: string,
  name = 'Tikka T3x Lite',
  categoryId = 'firearms',
): string =>
  `insert into items (id, category_id, name, weight_grams) values ('${id}', '${categoryId}', '${name}', 2900)`;

const insertPack = (id: string, name = 'Hunting Pack'): string =>
  `insert into packs (id, name) values ('${id}', '${name}')`;

const insertLine = (id: string, packId: string, itemId: string, qty = 1): string =>
  `insert into pack_items (id, pack_id, item_id, qty) values ('${id}', '${packId}', '${itemId}', ${qty})`;

async function tableNames(driver: SqlDriver): Promise<string[]> {
  const rows = await driver.getAllAsync<{ name: string }>(
    "select name from sqlite_master where type = 'table' order by name",
  );
  return rows.map((row) => row.name);
}

async function columnNames(driver: SqlDriver, table: string): Promise<string[]> {
  const rows = await driver.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((row) => row.name);
}

async function countRows(driver: SqlDriver, table: string): Promise<number> {
  const row = await driver.getFirstAsync<{ n: number }>(
    `select count(*) as n from ${table}`,
  );
  return row?.n ?? -1;
}

/** Every row needed for the cascade and constraint fixtures, minus the subject. */
async function seedReferenceRows(store: TestStore): Promise<void> {
  await store.driver.execAsync(insertPack(PACK_ID));
  await store.driver.execAsync(insertPack(OTHER_PACK_ID, 'Day Pack'));
  await store.driver.execAsync(insertItem(ITEM_ID));
  await store.driver.execAsync(insertItem(LINKED_ITEM_ID, 'Leupold VX-5HD', 'optics'));
  await store.driver.execAsync(
    insertItem(UNRELATED_ITEM_ID, 'Torrentshell 3L', 'clothing'),
  );
  await store.driver.execAsync(
    insertLine('aaaaaaaa-0000-4000-8000-000000000001', PACK_ID, ITEM_ID),
  );
  await store.driver.execAsync(
    insertLine('aaaaaaaa-0000-4000-8000-000000000002', OTHER_PACK_ID, ITEM_ID),
  );
  await store.driver.execAsync(
    `insert into item_links (item_id, linked_item_id) values ('${ITEM_ID}', '${LINKED_ITEM_ID}')`,
  );
}

afterAll(cleanup);

describe('opening the local store', () => {
  it('turns foreign keys on for the connection, not inside the migration transaction', async () => {
    const path = tempDatabasePath();
    const driver = createTestDriver(path);
    // What the driver hands over: enforcement off, exactly as SQLite ships and as
    // expo-sqlite ships. If this ever reads 1, the assertion below proves nothing.
    expect(driver.raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 0 });

    const store = await openLocalDatabase({ driver });

    // Read through the store's own port, so this is what the repository sees. The
    // pragma is a no-op inside a transaction, so a store that issued it during
    // migration and closed the transaction would still read 0 here.
    const afterOpen = await store.driver.getFirstAsync<{ foreign_keys: number }>(
      'PRAGMA foreign_keys',
    );
    expect(afterOpen?.foreign_keys).toBe(1);
    // And enforcement is genuinely live once migrations have finished, not just
    // the flag.
    await expect(
      store.driver.execAsync(
        `insert into pack_items (id, pack_id, item_id, qty) values ('x', 'no-such-pack', 'no-such-item', 1)`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    await store.close();
  });

  it('creates the tables the local schema needs', async () => {
    const store = await openTestStore();

    expect(await tableNames(store.driver)).toEqual(
      expect.arrayContaining([
        'categories',
        'items',
        'packs',
        'pack_items',
        'item_links',
      ]),
    );

    await store.close();
  });

  it('leaves the trip and profile tables out until Stage 2 and Stage 3', async () => {
    const store = await openTestStore();
    const names = await tableNames(store.driver);

    expect(names).not.toContain('trips');
    expect(names).not.toContain('trip_members');
    expect(names).not.toContain('trip_invites');
    expect(names).not.toContain('profiles');

    await store.close();
  });

  it('leaves user_id out of items and packs; it arrives with Stage 2 sync', async () => {
    const store = await openTestStore();

    expect(await columnNames(store.driver, 'items')).not.toContain('user_id');
    expect(await columnNames(store.driver, 'packs')).not.toContain('user_id');
    // And everything else docs/DATA-MODEL.md names is still there.
    expect(await columnNames(store.driver, 'items')).toEqual(
      expect.arrayContaining([
        'id',
        'category_id',
        'brand',
        'name',
        'weight_grams',
        'is_consumable',
        'pack_weight_grams',
        'units_per_pack',
        'is_worn',
        'litre_volume',
        'must_have',
        'created_at',
        'updated_at',
      ]),
    );
    expect(await columnNames(store.driver, 'pack_items')).toEqual(
      expect.arrayContaining(['id', 'pack_id', 'item_id', 'qty', 'ticked', 'position']),
    );
    expect(await columnNames(store.driver, 'item_links')).toEqual(
      expect.arrayContaining(['item_id', 'linked_item_id']),
    );

    await store.close();
  });

  it('writes the database to a real file on disk', async () => {
    const store = await openTestStore();
    expect(databaseFileExists(store.path)).toBe(true);

    await store.close();
  });
});

describe('seeding the system categories', () => {
  it('seeds every category from the taxonomy on first run', async () => {
    const store = await openTestStore();

    expect(await store.repository.getCategories()).toEqual(SORTED_CATEGORIES);
    expect(await countRows(store.driver, 'categories')).toBe(CATEGORIES.length);

    await store.close();
  });

  it('does not duplicate the categories when the database is opened again', async () => {
    const first = await openTestStore();
    const rifle = await first.repository.createItem(
      newItem({ name: 'Tikka T3x Lite', weightGrams: 2900, categoryId: 'firearms' }),
    );
    await first.close();

    const second = await openTestStore({ path: first.path });

    expect(await countRows(second.driver, 'categories')).toBe(CATEGORIES.length);
    expect(await second.repository.getCategories()).toEqual(SORTED_CATEGORIES);
    // The user's own data is what was at risk here, not the seed.
    expect((await second.repository.getItem(rifle.id))?.weightGrams).toBe(2900);

    await second.close();
  });

  it('does not re-seed on a third open either', async () => {
    const first = await openTestStore();
    await first.repository.createPack(
      newPack({ name: 'Hunting Pack', weightGrams: 2400 }),
    );
    await first.close();

    await openTestStore({ path: first.path }).then(async (second) => {
      expect(await countRows(second.driver, 'categories')).toBe(CATEGORIES.length);
      await second.close();
    });

    const third = await openTestStore({ path: first.path });
    expect(await countRows(third.driver, 'categories')).toBe(CATEGORIES.length);
    expect(await third.repository.listPacks()).toHaveLength(1);

    await third.close();
  });
});

describe('migrations', () => {
  it('runs every migration exactly once, and never again on reopen', async () => {
    const ran: number[] = [];
    const migrations = [
      spyMigration(1, 'create table first_table (x integer)', ran),
      spyMigration(2, 'create table second_table (y integer)', ran),
    ];

    const first = await openTestStore({ migrations });
    expect(ran).toEqual([1, 2]);
    await first.close();

    const second = await openTestStore({ path: first.path, migrations });
    expect(ran).toEqual([1, 2]);
    expect(await tableNames(second.driver)).toEqual(
      expect.arrayContaining(['first_table', 'second_table']),
    );

    await second.close();
  });

  it('applies a later migration to an existing database without losing rows', async () => {
    const first = await openTestStore();
    const rifle = await first.repository.createItem(
      newItem({ name: 'Tikka T3x Lite', weightGrams: 2900, categoryId: 'firearms' }),
    );
    const pack = await first.repository.createPack(
      newPack({
        name: 'Stone Glacier Sky Talus 6900',
        weightGrams: 2400,
        litreVolume: 113,
      }),
    );
    await first.close();

    const last = MIGRATIONS[MIGRATIONS.length - 1];
    if (last === undefined) throw new Error('MIGRATIONS must not be empty');

    const ran: number[] = [];
    const next = spyMigration(
      last.version + 1,
      'alter table items add column colour text',
      ran,
    );
    const second = await openTestStore({
      path: first.path,
      migrations: [...MIGRATIONS, next],
    });

    expect(ran).toEqual([last.version + 1]);
    expect(await columnNames(second.driver, 'items')).toContain('colour');
    // The rows written before the migration are still exactly as they were.
    expect((await second.repository.getItem(rifle.id))?.weightGrams).toBe(2900);
    expect((await second.repository.getItem(rifle.id))?.name).toBe('Tikka T3x Lite');
    expect((await second.repository.getPack(pack.id))?.litreVolume).toBe(113);

    await second.close();
  });

  it('stops at the last migration that worked and retries the one that did not', async () => {
    const ran: number[] = [];
    const keep = spyMigration(1, 'create table keep_me (x integer)', ran);
    const interrupted = {
      version: 2,
      up: async (driver: SqlDriver) => {
        await driver.execAsync('create table added_late (y integer)');
        throw new Error('interrupted mid-migration');
      },
    };

    const path = tempDatabasePath();
    await expect(
      openTestStore({ path, migrations: [keep, interrupted] }),
    ).rejects.toThrow('interrupted mid-migration');

    // The half-applied migration left nothing behind, and the earlier one stuck.
    const midway = await openTestStore({ path, migrations: [] });
    expect(await tableNames(midway.driver)).toContain('keep_me');
    expect(await tableNames(midway.driver)).not.toContain('added_late');
    await midway.driver.execAsync('insert into keep_me (x) values (42)');
    await midway.close();

    const repaired = await openTestStore({
      path,
      migrations: [keep, spyMigration(2, 'create table added_late (y integer)', ran)],
    });
    expect(await tableNames(repaired.driver)).toContain('added_late');
    // Version 1 was not applied a second time, so the row is still there.
    expect(ran).toEqual([1, 2]);
    expect(
      await repaired.driver.getFirstAsync<{ x: number }>('select x from keep_me'),
    ).toEqual({
      x: 42,
    });

    await repaired.close();
  });

  it('refuses two migrations that claim the same version', async () => {
    const ran: number[] = [];

    await expect(
      openTestStore({
        migrations: [
          spyMigration(1, 'create table one (x integer)', ran),
          spyMigration(1, 'create table two (y integer)', ran),
        ],
      }),
    ).rejects.toThrow();
  });
});

describe('constraints SQLite enforces, not JavaScript', () => {
  it('refuses a pack line whose pack does not exist', async () => {
    const store = await openTestStore();
    await store.driver.execAsync(insertItem(ITEM_ID));

    await expect(
      store.driver.execAsync(
        insertLine('aaaaaaaa-0000-4000-8000-000000000001', PACK_ID, ITEM_ID),
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
    expect(await countRows(store.driver, 'pack_items')).toBe(0);

    await store.close();
  });

  it('refuses a pack line whose item does not exist', async () => {
    const store = await openTestStore();
    await store.driver.execAsync(insertPack(PACK_ID));

    await expect(
      store.driver.execAsync(
        insertLine('aaaaaaaa-0000-4000-8000-000000000001', PACK_ID, ITEM_ID),
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
    expect(await countRows(store.driver, 'pack_items')).toBe(0);

    await store.close();
  });

  it('refuses an item in a category outside the system taxonomy', async () => {
    // D5: the category set is fixed, so a typo must not become a new category.
    const store = await openTestStore();

    await expect(
      store.driver.execAsync(insertItem(ITEM_ID, 'Rifle', 'my-own-guns')),
    ).rejects.toThrow(/FOREIGN KEY/i);
    expect(await countRows(store.driver, 'items')).toBe(0);

    await store.close();
  });

  it('refuses a line with no quantity in it', async () => {
    const store = await openTestStore();
    await seedReferenceRows(store);

    await expect(
      store.driver.execAsync(
        insertLine('aaaaaaaa-0000-4000-8000-00000000000a', PACK_ID, ITEM_ID, 0),
      ),
    ).rejects.toThrow(/CHECK/i);
    expect(await countRows(store.driver, 'pack_items')).toBe(2);

    await store.close();
  });

  it('refuses a negative quantity', async () => {
    const store = await openTestStore();
    await seedReferenceRows(store);

    await expect(
      store.driver.execAsync(
        insertLine('aaaaaaaa-0000-4000-8000-00000000000a', PACK_ID, ITEM_ID, -3),
      ),
    ).rejects.toThrow(/CHECK/i);

    await store.close();
  });

  it('refuses a negative item weight', async () => {
    const store = await openTestStore();

    await expect(
      store.driver.execAsync(
        `insert into items (id, category_id, name, weight_grams) values ('${ITEM_ID}', 'firearms', 'Mystery', -1)`,
      ),
    ).rejects.toThrow(/CHECK/i);
    expect(await countRows(store.driver, 'items')).toBe(0);

    await store.close();
  });

  it('refuses a negative box weight and a box holding no rounds', async () => {
    const store = await openTestStore();

    await expect(
      store.driver.execAsync(
        `insert into items (id, category_id, name, pack_weight_grams) values ('${ITEM_ID}', 'firearms', 'Ammo', -520)`,
      ),
    ).rejects.toThrow(/CHECK/i);

    await expect(
      store.driver.execAsync(
        `insert into items (id, category_id, name, weight_grams, pack_weight_grams, units_per_pack) values ('${ITEM_ID}', 'firearms', 'Ammo', 0, 520, 0)`,
      ),
    ).rejects.toThrow(/CHECK/i);
    expect(await countRows(store.driver, 'items')).toBe(0);

    await store.close();
  });

  it('refuses negative litre volume on an item and on a pack', async () => {
    const store = await openTestStore();

    await expect(
      store.driver.execAsync(
        `insert into items (id, category_id, name, weight_grams, litre_volume) values ('${ITEM_ID}', 'packs', 'Bag', 0, -0.5)`,
      ),
    ).rejects.toThrow(/CHECK/i);

    await expect(
      store.driver.execAsync(
        `insert into packs (id, name, litre_volume) values ('${PACK_ID}', 'Bag', -113)`,
      ),
    ).rejects.toThrow(/CHECK/i);
    expect(await countRows(store.driver, 'packs')).toBe(0);

    await store.close();
  });

  it('refuses the same item twice in one pack', async () => {
    const store = await openTestStore();
    await seedReferenceRows(store);

    await expect(
      store.driver.execAsync(
        insertLine('aaaaaaaa-0000-4000-8000-00000000000a', PACK_ID, ITEM_ID),
      ),
    ).rejects.toThrow(/UNIQUE/i);
    expect(await countRows(store.driver, 'pack_items')).toBe(2);

    await store.close();
  });

  it('allows the same item in two different packs', async () => {
    const store = await openTestStore();
    await seedReferenceRows(store);

    // The other pack already has it. Uniqueness is per pack, not per item.
    expect(await countRows(store.driver, 'pack_items')).toBe(2);
    await store.close();
  });

  it('refuses an item linked to itself', async () => {
    const store = await openTestStore();
    await store.driver.execAsync(insertItem(ITEM_ID));

    await expect(
      store.driver.execAsync(
        `insert into item_links (item_id, linked_item_id) values ('${ITEM_ID}', '${ITEM_ID}')`,
      ),
    ).rejects.toThrow(/CHECK/i);
    expect(await countRows(store.driver, 'item_links')).toBe(0);

    await store.close();
  });

  it('refuses a link to an item that does not exist', async () => {
    const store = await openTestStore();
    await store.driver.execAsync(insertItem(ITEM_ID));

    await expect(
      store.driver.execAsync(
        `insert into item_links (item_id, linked_item_id) values ('${ITEM_ID}', '${LINKED_ITEM_ID}')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    await store.close();
  });

  it('deleting a pack takes its lines with it and leaves other packs alone', async () => {
    const store = await openTestStore();
    await seedReferenceRows(store);

    await store.driver.runAsync('delete from packs where id = ?', PACK_ID);

    expect(await countRows(store.driver, 'packs')).toBe(1);
    expect(await countRows(store.driver, 'pack_items')).toBe(1);
    const survivor = await store.driver.getFirstAsync<{ pack_id: string }>(
      'select pack_id from pack_items',
    );
    expect(survivor?.pack_id).toBe(OTHER_PACK_ID);
    // The catalogue is not touched: a pack is not a reason to lose gear.
    expect(await countRows(store.driver, 'items')).toBe(3);

    await store.close();
  });

  it('deleting an item removes the lines that referenced it', async () => {
    const store = await openTestStore();
    await seedReferenceRows(store);

    await store.driver.runAsync('delete from items where id = ?', ITEM_ID);

    expect(await countRows(store.driver, 'pack_items')).toBe(0);
    expect(await countRows(store.driver, 'packs')).toBe(2);

    await store.close();
  });

  it('refuses a link from an item that does not exist', async () => {
    const store = await openTestStore();
    await seedReferenceRows(store);

    await expect(
      store.driver.execAsync(
        `insert into item_links (item_id, linked_item_id) values ('missing-from-side', '${LINKED_ITEM_ID}')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
    expect(await countRows(store.driver, 'item_links')).toBe(1);

    await store.close();
  });

  it('deleting an item removes links from it and links to it', async () => {
    // A three-item ring: rifle -> scope -> binoculars -> rifle. The middle item
    // is the source of one link and the target of another, so deleting it
    // exercises both cascades at once. Only the link that does not touch it may
    // survive, which is why the survivor is checked by identity and not by count:
    // a schema that cascades only one column leaves a different row behind.
    const store = await openTestStore();
    await seedReferenceRows(store);
    // seedReferenceRows gives rifle -> scope. Close the ring so the middle item
    // has a link pointing at it and a link pointing away from it.
    await store.driver.execAsync(
      `insert into item_links (item_id, linked_item_id) values ('${LINKED_ITEM_ID}', '${UNRELATED_ITEM_ID}')`,
    );
    await store.driver.execAsync(
      `insert into item_links (item_id, linked_item_id) values ('${UNRELATED_ITEM_ID}', '${ITEM_ID}')`,
    );
    expect(await countRows(store.driver, 'item_links')).toBe(3);

    await store.driver.runAsync('delete from items where id = ?', LINKED_ITEM_ID);

    const remaining = await store.driver.getAllAsync<{
      item_id: string;
      linked_item_id: string;
    }>('select item_id, linked_item_id from item_links order by item_id');
    expect(remaining).toEqual([{ item_id: UNRELATED_ITEM_ID, linked_item_id: ITEM_ID }]);
    expect(await countRows(store.driver, 'items')).toBe(2);

    await store.close();
  });
});
