import { uuid } from 'expo-modules-core';

import type { SqlDriver, SqlValue } from '@/data/db';
import type {
  Category,
  CategoryId,
  GearItem,
  ItemId,
  ItemLinks,
  LineId,
  Pack,
  PackId,
  PackLine,
} from '@/types/gear';

/**
 * The local repository (D6): every read and write the screens make, and nothing
 * else. It is the only place that speaks SQL for items, packs and pack lines,
 * which is what keeps the pack screen, the compare screen and a future Stage 2
 * sync from disagreeing about what a row is (R7).
 *
 * Two rules run through the whole file.
 *
 * Storage is transparent. A weight, a null and a flag come back out exactly as
 * they went in, and every write reads its own row back rather than returning
 * the object it happened to send. `null` never becomes `0` — the one exception
 * is `packs.weight_grams`, which the schema allows to be null and the domain
 * type does not, because `summarisePack` adds it straight into base weight.
 *
 * The database is the enforcement. A quantity of zero, a negative weight, an
 * item in a category that does not exist and the same item in one pack twice
 * are all refused by constraints, not by checks here, so there is one
 * implementation of each rule and it cannot be bypassed by a new caller.
 */

/** An item as a form submits it, before the store fills in id and timestamps. */
export interface NewItem {
  categoryId: CategoryId;
  brand: string | null;
  name: string;
  weightGrams: number;
  isConsumable: boolean;
  packWeightGrams: number | null;
  unitsPerPack: number | null;
  isWorn: boolean;
  litreVolume: number | null;
  mustHave: boolean;
}

/** A pack as the pack form submits it, before the store fills in id and time. */
export interface NewPack {
  name: string;
  type: string | null;
  /** The bag's own weight. Part of base weight, never worn and never consumed. */
  weightGrams: number;
  litreVolume: number | null;
}

export interface NewLine {
  packId: PackId;
  itemId: ItemId;
  qty?: number;
  ticked?: boolean;
  position?: number;
}

export type ItemPatch = Partial<NewItem>;
export type PackPatch = Partial<NewPack>;
export type LinePatch = Partial<Pick<NewLine, 'qty' | 'ticked' | 'position'>>;

export interface ItemFilter {
  categoryId?: CategoryId;
  /** Matched case-insensitively against the name and the brand. */
  search?: string;
}

/**
 * A pack line and the item it points at, from one joined read.
 *
 * The line keeps its own `id`: every later edit and tick lands on the line, and
 * a read that let the item's id overwrite it would send those edits nowhere.
 */
export interface PackContentsLine extends PackLine {
  item: GearItem;
}

export interface LocalRepository {
  getCategories(): Promise<Category[]>;

  getItem(id: ItemId): Promise<GearItem | null>;
  /** One query for any number of ids. Ids with no row are skipped, not invented. */
  getItemsByIds(ids: readonly ItemId[]): Promise<GearItem[]>;
  listItems(filter?: ItemFilter): Promise<GearItem[]>;
  createItem(item: NewItem): Promise<GearItem>;
  updateItem(id: ItemId, patch: ItemPatch): Promise<GearItem | null>;
  deleteItem(id: ItemId): Promise<void>;

  getPack(id: PackId): Promise<Pack | null>;
  listPacks(): Promise<Pack[]>;
  createPack(pack: NewPack): Promise<Pack>;
  updatePack(id: PackId, patch: PackPatch): Promise<Pack | null>;
  deletePack(id: PackId): Promise<void>;

  getLine(id: LineId): Promise<PackLine | null>;
  listLines(packId: PackId): Promise<PackLine[]>;
  /** One joined read for the whole pack, whatever the size of the pack. */
  getPackContents(packId: PackId): Promise<PackContentsLine[]>;
  addLine(line: NewLine): Promise<PackLine>;
  updateLine(id: LineId, patch: LinePatch): Promise<PackLine | null>;
  deleteLine(id: LineId): Promise<void>;

  getItemLinks(): Promise<ItemLinks>;
  listLinkedItemIds(itemId: ItemId): Promise<ItemId[]>;
  addItemLink(itemId: ItemId, linkedItemId: ItemId): Promise<void>;
  removeItemLink(itemId: ItemId, linkedItemId: ItemId): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* rows                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Booleans are stored as 0/1, so a flag can never come back out as a 0 or a 1
 * and be mistaken for a weight.
 */
function toSqlValue(value: string | number | boolean | null): SqlValue {
  return typeof value === 'boolean' ? Number(value) : value;
}

function toBoolean(value: number): boolean {
  return value !== 0;
}

/** ISO-8601 in UTC with milliseconds, which is what `timestamptz` round-trips to. */
function now(): string {
  return new Date().toISOString();
}

/**
 * Ids are generated here, not by the database.
 *
 * Stage 2 pushes the same primary key, and a row created offline has to arrive
 * in the cloud under the id the app already knows it by. `uuid.v4()` is the
 * generator Expo ships natively, and its shape matches Postgres'
 * `gen_random_uuid()`.
 */
function newId(): string {
  return uuid.v4();
}

interface ItemRow {
  id: ItemId;
  category_id: CategoryId;
  brand: string | null;
  name: string;
  weight_grams: number;
  is_consumable: number;
  pack_weight_grams: number | null;
  units_per_pack: number | null;
  is_worn: number;
  litre_volume: number | null;
  must_have: number;
  created_at: string;
  updated_at: string;
}

interface PackRow {
  id: PackId;
  name: string;
  type: string | null;
  weight_grams: number | null;
  litre_volume: number | null;
  created_at: string;
  updated_at: string;
}

interface LineRow {
  id: LineId;
  pack_id: PackId;
  item_id: ItemId;
  qty: number;
  ticked: number;
  position: number;
}

/** The item's id is the line's `item_id`, so the join does not select it twice. */
type PackContentsRow = LineRow & Omit<ItemRow, 'id'>;

interface CategoryRow {
  id: CategoryId;
  name: string;
  sort_order: number;
}

/* -------------------------------------------------------------------------- */
/* columns and statements                                                      */
/* -------------------------------------------------------------------------- */

const ITEM_COLUMNS = [
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
] as const;

const PACK_COLUMNS = [
  'id',
  'name',
  'type',
  'weight_grams',
  'litre_volume',
  'created_at',
  'updated_at',
] as const;

const LINE_COLUMNS = ['id', 'pack_id', 'item_id', 'qty', 'ticked', 'position'] as const;

function prefixed(prefix: string, columns: readonly string[]): string {
  return columns.map((column) => `${prefix}${column}`).join(', ');
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

const ITEM_INSERT = `insert into items (${ITEM_COLUMNS.join(', ')}) values (${placeholders(
  ITEM_COLUMNS.length,
)})`;

const PACK_INSERT = `insert into packs (${PACK_COLUMNS.join(', ')}) values (${placeholders(
  PACK_COLUMNS.length,
)})`;

const LINE_INSERT =
  'insert into pack_items (id, pack_id, item_id, qty, ticked, position) values (?, ?, ?, ?, ?, ?)';

/**
 * The pack screen's read: the lines and the items they point at, in one
 * statement.
 *
 * Ties on `position` are a UI bug, not a reason to drop a line, so `l.id` only
 * breaks them into a repeatable order.
 */
const PACK_CONTENTS = `
  select ${prefixed('l.', LINE_COLUMNS)},
         ${prefixed(
           'i.',
           ITEM_COLUMNS.filter((column) => column !== 'id'),
         )}
  from pack_items l
  join items i on i.id = l.item_id
  where l.pack_id = ?
  order by l.position, l.id`;

const ITEM_COLUMNS_BY_FIELD: Readonly<Record<keyof NewItem, string>> = {
  categoryId: 'category_id',
  brand: 'brand',
  name: 'name',
  weightGrams: 'weight_grams',
  isConsumable: 'is_consumable',
  packWeightGrams: 'pack_weight_grams',
  unitsPerPack: 'units_per_pack',
  isWorn: 'is_worn',
  litreVolume: 'litre_volume',
  mustHave: 'must_have',
};

const PACK_COLUMNS_BY_FIELD: Readonly<Record<keyof NewPack, string>> = {
  name: 'name',
  type: 'type',
  weightGrams: 'weight_grams',
  litreVolume: 'litre_volume',
};

const LINE_COLUMNS_BY_FIELD: Readonly<Record<keyof LinePatch, string>> = {
  qty: 'qty',
  ticked: 'ticked',
  position: 'position',
};

/* -------------------------------------------------------------------------- */
/* the repository                                                              */
/* -------------------------------------------------------------------------- */

export function createLocalRepository(
  driver: SqlDriver,
  userId: string,
): LocalRepository {
  function toItem(row: ItemRow): GearItem {
    return {
      id: row.id,
      userId,
      categoryId: row.category_id,
      brand: row.brand,
      name: row.name,
      weightGrams: row.weight_grams,
      isConsumable: toBoolean(row.is_consumable),
      packWeightGrams: row.pack_weight_grams,
      unitsPerPack: row.units_per_pack,
      isWorn: toBoolean(row.is_worn),
      litreVolume: row.litre_volume,
      mustHave: toBoolean(row.must_have),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function toPack(row: PackRow): Pack {
    return {
      id: row.id,
      userId,
      name: row.name,
      type: row.type,
      // The column is nullable and `Pack.weightGrams` is not: a null here would
      // make the whole base figure null in the weight engine.
      weightGrams: row.weight_grams ?? 0,
      litreVolume: row.litre_volume,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function toLine(row: LineRow): PackLine {
    return {
      id: row.id,
      packId: row.pack_id,
      itemId: row.item_id,
      qty: row.qty,
      ticked: toBoolean(row.ticked),
      position: row.position,
    };
  }

  async function getItem(id: ItemId): Promise<GearItem | null> {
    const row = await driver.getFirstAsync<ItemRow>(
      `select ${ITEM_COLUMNS.join(', ')} from items where id = ?`,
      id,
    );
    return row === null ? null : toItem(row);
  }

  async function getPack(id: PackId): Promise<Pack | null> {
    const row = await driver.getFirstAsync<PackRow>(
      `select ${PACK_COLUMNS.join(', ')} from packs where id = ?`,
      id,
    );
    return row === null ? null : toPack(row);
  }

  async function getLine(id: LineId): Promise<PackLine | null> {
    const row = await driver.getFirstAsync<LineRow>(
      `select ${LINE_COLUMNS.join(', ')} from pack_items where id = ?`,
      id,
    );
    return row === null ? null : toLine(row);
  }

  return {
    async getCategories(): Promise<Category[]> {
      const rows = await driver.getAllAsync<CategoryRow>(
        'select id, name, sort_order from categories order by sort_order, name',
      );
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
      }));
    },

    getItem,

    async getItemsByIds(ids: readonly ItemId[]): Promise<GearItem[]> {
      if (ids.length === 0) return [];

      const rows = await driver.getAllAsync<ItemRow>(
        `select ${ITEM_COLUMNS.join(', ')} from items where id in (${placeholders(ids.length)})`,
        ...ids,
      );
      return rows.map(toItem);
    },

    async listItems(filter: ItemFilter = {}): Promise<GearItem[]> {
      const where: string[] = [];
      const params: SqlValue[] = [];

      if (filter.categoryId !== undefined) {
        where.push('i.category_id = ?');
        params.push(filter.categoryId);
      }

      if (filter.search !== undefined && filter.search !== '') {
        // SQLite's LIKE ignores ASCII case, which is what a search box needs.
        // `%` and `_` a user typed are text, not patterns.
        const pattern = likePattern(filter.search);
        where.push(
          "(i.name like ? escape '\\' or coalesce(i.brand, '') like ? escape '\\')",
        );
        params.push(pattern, pattern);
      }

      const rows = await driver.getAllAsync<ItemRow>(
        `select ${prefixed('i.', ITEM_COLUMNS)}
         from items i
         join categories c on c.id = i.category_id
         ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
         order by c.sort_order, i.name`,
        ...params,
      );
      return rows.map(toItem);
    },

    async createItem(item: NewItem): Promise<GearItem> {
      const id = newId();
      const stamp = now();

      await driver.runAsync(
        ITEM_INSERT,
        id,
        item.categoryId,
        item.brand,
        item.name,
        item.weightGrams,
        toSqlValue(item.isConsumable),
        item.packWeightGrams,
        item.unitsPerPack,
        toSqlValue(item.isWorn),
        item.litreVolume,
        toSqlValue(item.mustHave),
        stamp,
        stamp,
      );

      return readBack(await getItem(id), `item ${id}`);
    },

    async updateItem(id: ItemId, patch: ItemPatch): Promise<GearItem | null> {
      await writeUpdate(driver, 'items', id, [
        ...assignmentsFor(patch, ITEM_COLUMNS_BY_FIELD),
        // `createdAt` is not in the patch map, so it cannot be moved by an edit.
        { column: 'updated_at', value: now() },
      ]);
      return getItem(id);
    },

    async deleteItem(id: ItemId): Promise<void> {
      // The lines and links that referenced it go with it, by constraint.
      await driver.runAsync('delete from items where id = ?', id);
    },

    getPack,

    async listPacks(): Promise<Pack[]> {
      const rows = await driver.getAllAsync<PackRow>(
        `select ${PACK_COLUMNS.join(', ')} from packs order by name`,
      );
      return rows.map(toPack);
    },

    async createPack(pack: NewPack): Promise<Pack> {
      const id = newId();
      const stamp = now();

      await driver.runAsync(
        PACK_INSERT,
        id,
        pack.name,
        pack.type,
        pack.weightGrams,
        pack.litreVolume,
        stamp,
        stamp,
      );

      return readBack(await getPack(id), `pack ${id}`);
    },

    async updatePack(id: PackId, patch: PackPatch): Promise<Pack | null> {
      await writeUpdate(driver, 'packs', id, [
        ...assignmentsFor(patch, PACK_COLUMNS_BY_FIELD),
        { column: 'updated_at', value: now() },
      ]);
      return getPack(id);
    },

    async deletePack(id: PackId): Promise<void> {
      await driver.runAsync('delete from packs where id = ?', id);
    },

    getLine,

    async listLines(packId: PackId): Promise<PackLine[]> {
      const rows = await driver.getAllAsync<LineRow>(
        `select ${LINE_COLUMNS.join(', ')} from pack_items where pack_id = ? order by position, id`,
        packId,
      );
      return rows.map(toLine);
    },

    async getPackContents(packId: PackId): Promise<PackContentsLine[]> {
      const rows = await driver.getAllAsync<PackContentsRow>(PACK_CONTENTS, packId);
      return rows.map((row) => ({
        ...toLine(row),
        item: toItem({ ...row, id: row.item_id }),
      }));
    },

    async addLine(line: NewLine): Promise<PackLine> {
      const id = newId();

      await driver.runAsync(
        LINE_INSERT,
        id,
        line.packId,
        line.itemId,
        line.qty ?? 1,
        toSqlValue(line.ticked ?? false),
        line.position ?? 0,
      );

      return readBack(await getLine(id), `line ${id}`);
    },

    async updateLine(id: LineId, patch: LinePatch): Promise<PackLine | null> {
      await writeUpdate(
        driver,
        'pack_items',
        id,
        assignmentsFor(patch, LINE_COLUMNS_BY_FIELD),
      );
      return getLine(id);
    },

    async deleteLine(id: LineId): Promise<void> {
      await driver.runAsync('delete from pack_items where id = ?', id);
    },

    async getItemLinks(): Promise<ItemLinks> {
      const rows = await driver.getAllAsync<{ item_id: ItemId; linked_item_id: ItemId }>(
        'select item_id, linked_item_id from item_links order by item_id, linked_item_id',
      );

      const links: Record<ItemId, ItemId[]> = {};
      for (const row of rows) {
        (links[row.item_id] ??= []).push(row.linked_item_id);
      }
      return links;
    },

    async listLinkedItemIds(itemId: ItemId): Promise<ItemId[]> {
      const rows = await driver.getAllAsync<{ linked_item_id: ItemId }>(
        'select linked_item_id from item_links where item_id = ? order by linked_item_id',
        itemId,
      );
      return rows.map((row) => row.linked_item_id);
    },

    async addItemLink(itemId: ItemId, linkedItemId: ItemId): Promise<void> {
      // A plain insert, not `or ignore`: a self-link and a link to an item that
      // is not there are both mistakes, and both are refused by the schema.
      await driver.runAsync(
        'insert into item_links (item_id, linked_item_id) values (?, ?)',
        itemId,
        linkedItemId,
      );
    },

    async removeItemLink(itemId: ItemId, linkedItemId: ItemId): Promise<void> {
      await driver.runAsync(
        'delete from item_links where item_id = ? and linked_item_id = ?',
        itemId,
        linkedItemId,
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** A row that was just written has to read back. Anything else is a bug here. */
function readBack<T>(row: T | null, what: string): T {
  if (row === null) throw new Error(`${what} was written and then not found`);
  return row;
}

interface Assignment {
  column: string;
  value: SqlValue;
}

/** A patch field maps to exactly one column, and the column map is exhaustive. */
type ScalarFields = Record<string, string | number | boolean | null>;

/** Only the fields the caller actually set. `undefined` counts as not set. */
function assignmentsFor<T extends ScalarFields>(
  patch: Partial<T>,
  columns: Readonly<Record<keyof T, string>>,
): Assignment[] {
  return (Object.keys(columns) as (keyof T & string)[])
    .filter((field) => patch[field] !== undefined)
    .map((field) => ({
      column: columns[field],
      value: toSqlValue(patch[field] ?? null),
    }));
}

async function writeUpdate(
  driver: SqlDriver,
  table: string,
  id: string,
  set: readonly Assignment[],
): Promise<void> {
  if (set.length === 0) return;

  await driver.runAsync(
    `update ${table} set ${set.map((entry) => `${entry.column} = ?`).join(', ')} where id = ?`,
    ...set.map((entry) => entry.value),
    id,
  );
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
