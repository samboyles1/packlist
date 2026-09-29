/// <reference types="node" />
import { SORTED_CATEGORIES } from '@/data/categories';
import { LOCAL_USER_ID } from '@/data/db';
import type { LocalRepository, NewItem, PackContentsLine } from '@/data/localRepository';
import {
  categoryBreakdown,
  collectLinkedItemIds,
  resolveUnitWeight,
  summarisePack,
} from '@/lib/weights';
import type { PackWeightInput } from '@/lib/weights';
import type { GearItem, ItemLinks, Pack, PackId, PackLine } from '@/types/gear';

import {
  ARTIFACT,
  cleanup,
  databaseFileExists,
  newItem,
  newPack,
  openTestStore,
  sleep,
} from './helpers/storeFixtures';
import type { TestStore } from './helpers/storeFixtures';

/**
 * S1-02 — the local store's read and write surface, and the guarantees the rest
 * of Stage 1 stands on.
 *
 * Two things are being pinned here. The first is ordinary CRUD: the screens in
 * S1-10 to S1-26 need insert, read, update, delete, filter, ordering, ticks and
 * a joined pack-contents query. The second is that storage is *transparent* —
 * a weight, a null and a boolean come back out exactly as they went in, and a
 * pack weighs the same number whether the rows are still in memory or have been
 * through SQLite. That second one is R7: the bug class where every screen is
 * individually right and the total is wrong.
 */

/** Postgres `uuid` with `gen_random_uuid()`. Stage 2 pushes the same id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOW = '2026-01-01T00:00:00.000Z';

function must<T>(value: T | null | undefined, what = 'a row'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/**
 * The artifact's pack, written into the store. Figures are the ones the original
 * app rendered: a 2.4 kg / 113 L bag, the 2900 g rifle, its 848 g of linked
 * gear, worn boots, a stack of meals and 20 rounds of 7mm-08.
 */
async function seedArtifactPack(repository: LocalRepository): Promise<PackId> {
  const bag = await repository.createPack(
    newPack({
      name: ARTIFACT.bag.name,
      type: 'Hunting Pack',
      weightGrams: ARTIFACT.bag.weightGrams,
      litreVolume: ARTIFACT.bag.litreVolume,
    }),
  );
  const rifle = await repository.createItem(
    newItem({ categoryId: 'firearms', name: ARTIFACT.rifle.name, weightGrams: 2900 }),
  );
  const scope = await repository.createItem(
    newItem({ categoryId: 'optics', name: ARTIFACT.scope.name, weightGrams: 561 }),
  );
  const rings = await repository.createItem(
    newItem({ categoryId: 'optics', name: ARTIFACT.rings.name, weightGrams: 57 }),
  );
  const bipod = await repository.createItem(
    newItem({ categoryId: 'pouches', name: ARTIFACT.bipod.name, weightGrams: 230 }),
  );
  const jacket = await repository.createItem(
    newItem({ categoryId: 'clothing', name: ARTIFACT.jacket.name, weightGrams: 290 }),
  );
  const boots = await repository.createItem(
    newItem({
      categoryId: 'footwear',
      name: ARTIFACT.boots.name,
      weightGrams: 2100,
      isWorn: true,
    }),
  );
  const meals = await repository.createItem(
    newItem({
      categoryId: 'food',
      name: ARTIFACT.meals.name,
      weightGrams: 190,
      isConsumable: true,
    }),
  );
  const ammo = await repository.createItem(
    newItem({
      categoryId: 'firearms',
      name: ARTIFACT.ammo.name,
      isConsumable: true,
      packWeightGrams: ARTIFACT.ammo.packWeightGrams,
      unitsPerPack: ARTIFACT.ammo.unitsPerPack,
    }),
  );

  await repository.addItemLink(rifle.id, scope.id);
  await repository.addItemLink(rifle.id, rings.id);
  await repository.addItemLink(rifle.id, bipod.id);

  await repository.addLine({ packId: bag.id, itemId: rifle.id, qty: 1, position: 0 });
  await repository.addLine({ packId: bag.id, itemId: jacket.id, qty: 1, position: 1 });
  await repository.addLine({ packId: bag.id, itemId: boots.id, qty: 1, position: 2 });
  await repository.addLine({ packId: bag.id, itemId: meals.id, qty: 4, position: 3 });
  await repository.addLine({ packId: bag.id, itemId: ammo.id, qty: 20, position: 4 });

  return bag.id;
}

/** The same pack, built in memory, for the round-trip comparison. */
function artifactPackInMemory(): PackWeightInput {
  const gear = (
    id: string,
    categoryId: string,
    weightGrams: number,
    over: Partial<GearItem> = {},
  ) => ({
    id,
    userId: LOCAL_USER_ID,
    categoryId,
    brand: null,
    name: id,
    weightGrams,
    isConsumable: false,
    packWeightGrams: null,
    unitsPerPack: null,
    isWorn: false,
    litreVolume: null,
    mustHave: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  const pack: Pack = {
    id: 'pack-1',
    userId: LOCAL_USER_ID,
    name: ARTIFACT.bag.name,
    type: 'Hunting Pack',
    weightGrams: 2400,
    litreVolume: 113,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items: GearItem[] = [
    gear(ARTIFACT.rifle.name, 'firearms', 2900),
    gear(ARTIFACT.scope.name, 'optics', 561),
    gear(ARTIFACT.rings.name, 'optics', 57),
    gear(ARTIFACT.bipod.name, 'pouches', 230),
    gear(ARTIFACT.jacket.name, 'clothing', 290),
    gear(ARTIFACT.boots.name, 'footwear', 2100, { isWorn: true }),
    gear(ARTIFACT.meals.name, 'food', 190, { isConsumable: true }),
    gear(ARTIFACT.ammo.name, 'firearms', 0, {
      isConsumable: true,
      packWeightGrams: 520,
      unitsPerPack: 20,
    }),
  ];

  const lines: PackLine[] = [
    [ARTIFACT.rifle.name, 1, 0],
    [ARTIFACT.jacket.name, 1, 1],
    [ARTIFACT.boots.name, 1, 2],
    [ARTIFACT.meals.name, 4, 3],
    [ARTIFACT.ammo.name, 20, 4],
  ].map(([itemId, qty, position], index) => ({
    id: `line-${index}`,
    packId: 'pack-1',
    itemId: String(itemId),
    qty: Number(qty),
    ticked: false,
    position: Number(position),
  }));

  const links: ItemLinks = {
    [ARTIFACT.rifle.name]: [
      ARTIFACT.scope.name,
      ARTIFACT.rings.name,
      ARTIFACT.bipod.name,
    ],
  };

  return {
    pack,
    lines,
    itemsById: new Map(items.map((entry) => [entry.id, entry])),
    links,
  };
}

/** The rifle is first in the artifact pack, at position 0. */
async function rifleLineIn(
  repository: LocalRepository,
  packId: PackId,
): Promise<PackLine> {
  const contents = await repository.getPackContents(packId);
  return must(
    contents.find((entry) => entry.item.name === ARTIFACT.rifle.name),
    'the rifle line',
  );
}

/**
 * Read a stored pack back the way the pack screen would, ready for the engine.
 *
 * Three queries in total, whatever the size of the pack: the joined lines, the
 * link map, and one bulk fetch for the linked items the lines do not mention. The
 * engine needs an item row for every link target, and a linked item is by
 * definition not on a line, so the pack screen cannot get them from
 * `getPackContents`. Resolving them one `getItem` at a time is the N+1 that
 * `reads the whole pack in one query` exists to prevent.
 */
async function readPackFromStore(
  repository: LocalRepository,
  packId: PackId,
): Promise<PackWeightInput & { contents: PackContentsLine[] }> {
  const pack = must(await repository.getPack(packId), 'the pack');
  const contents = await repository.getPackContents(packId);
  const links = await repository.getItemLinks();

  const itemsById = new Map(contents.map((entry) => [entry.item.id, entry.item]));
  const linkedIds = [
    ...collectLinkedItemIds(
      contents.map((entry) => entry.itemId),
      links,
    ),
  ]
    .filter((id) => !itemsById.has(id))
    .sort();
  for (const item of await repository.getItemsByIds(linkedIds)) {
    itemsById.set(item.id, item);
  }

  return { pack, contents, lines: contents, itemsById, links };
}

afterAll(cleanup);

describe('adding an item to the catalogue (S1-11, S1-12)', () => {
  it('gives every item an id Stage 2 can push as the Postgres primary key', async () => {
    const store = await openTestStore();

    const created = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name, weightGrams: 2900 }),
    );

    expect(created.id).toMatch(UUID);
    expect((await store.repository.getItem(created.id))?.id).toBe(created.id);

    await store.close();
  });

  it('reads an item back field for field, with every null still null', async () => {
    const store = await openTestStore();

    const created = await store.repository.createItem(
      newItem({
        categoryId: 'food',
        brand: 'Mountain House',
        name: 'Freeze-dried dinners',
        weightGrams: 0,
        isConsumable: true,
        packWeightGrams: 3000,
        unitsPerPack: 6,
        isWorn: false,
        litreVolume: null,
        mustHave: true,
      }),
    );
    const read = await store.repository.getItem(created.id);

    // One assertion for the whole shape: a null that became 0, a 1 that stayed 1
    // as a number, or a dropped field all fail here.
    expect(read).toEqual({
      id: created.id,
      userId: LOCAL_USER_ID,
      categoryId: 'food',
      brand: 'Mountain House',
      name: 'Freeze-dried dinners',
      weightGrams: 0,
      isConsumable: true,
      packWeightGrams: 3000,
      unitsPerPack: 6,
      isWorn: false,
      litreVolume: null,
      mustHave: true,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });

    await store.close();
  });

  it('stamps the local owner on everything, because Stage 1 has no accounts', async () => {
    const store = await openTestStore();

    // A caller cannot smuggle in an owner the cloud copy will later contradict.
    const smuggled = { ...newItem(), userId: 'someone-else' } as NewItem;
    const created = await store.repository.createItem(smuggled);

    expect(created.userId).toBe(LOCAL_USER_ID);
    expect((await store.repository.getItem(created.id))?.userId).toBe(LOCAL_USER_ID);

    await store.close();
  });

  it('stamps createdAt and updatedAt with a UTC time the cloud copy will accept', async () => {
    const store = await openTestStore();

    const created = await store.repository.createItem(newItem());

    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    // The time it claims is now, not a constant.
    expect(Date.parse(created.createdAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(created.updatedAt).toBe(created.createdAt);

    await store.close();
  });

  it('reads the flags back as booleans rather than 0 and 1', async () => {
    const store = await openTestStore();

    const worn = await store.repository.createItem(
      newItem({ isWorn: true, mustHave: true }),
    );
    const plain = await store.repository.createItem(
      newItem({ isWorn: false, mustHave: false }),
    );

    for (const id of [worn.id, plain.id]) {
      const read = must(await store.repository.getItem(id));
      expect(typeof read.isWorn).toBe('boolean');
      expect(typeof read.isConsumable).toBe('boolean');
      expect(typeof read.mustHave).toBe('boolean');
    }
    expect((await store.repository.getItem(worn.id))?.isWorn).toBe(true);
    expect((await store.repository.getItem(plain.id))?.isWorn).toBe(false);

    await store.close();
  });
});

describe('weights survive storage exactly (D8)', () => {
  it('keeps a 0 g placeholder at 0, not null', async () => {
    const store = await openTestStore();

    const placeholder = await store.repository.createItem(
      newItem({ name: 'To be weighed', weightGrams: 0 }),
    );
    const read = await store.repository.getItem(placeholder.id);

    expect(read?.weightGrams).toBe(0);
    expect(read?.weightGrams === null).toBe(false);

    await store.close();
  });

  it('keeps the 2900 g rifle at exactly 2900 g', async () => {
    const store = await openTestStore();

    const rifle = await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: ARTIFACT.rifle.name, weightGrams: 2900 }),
    );

    expect((await store.repository.getItem(rifle.id))?.weightGrams).toBe(2900);

    await store.close();
  });

  it('keeps a 20-round box of 7mm-08 exact, so a round still reads 26 g', async () => {
    const store = await openTestStore();

    const ammo = await store.repository.createItem(
      newItem({
        categoryId: 'firearms',
        name: ARTIFACT.ammo.name,
        isConsumable: true,
        weightGrams: 0,
        packWeightGrams: 520,
        unitsPerPack: 20,
      }),
    );
    const read = must(await store.repository.getItem(ammo.id));

    expect(read.packWeightGrams).toBe(520);
    expect(read.unitsPerPack).toBe(20);
    expect(resolveUnitWeight(read).grams).toBe(26);

    await store.close();
  });

  it('leaves a non-boxed consumable boxed to nothing, at null', async () => {
    const store = await openTestStore();

    // The artifact's "Clif Chocolate Chip — 68 g ea.": no box, no unit count.
    const bar = await store.repository.createItem(
      newItem({
        categoryId: 'food',
        name: ARTIFACT.bar.name,
        isConsumable: true,
        weightGrams: ARTIFACT.bar.weightGrams,
      }),
    );
    const read = must(await store.repository.getItem(bar.id));

    expect(read.packWeightGrams).toBeNull();
    expect(read.unitsPerPack).toBeNull();
    expect(resolveUnitWeight(read).grams).toBe(68);

    await store.close();
  });

  it('keeps a weight at the top of the int range exact', async () => {
    const store = await openTestStore();

    // Postgres `int` stops at 2147483647, so this is the largest weight that can
    // exist in the cloud copy. A narrower column or a lossy bind corrupts it.
    const heaviest = await store.repository.createItem(
      newItem({ name: 'Anvil', weightGrams: 2147483647 }),
    );

    expect((await store.repository.getItem(heaviest.id))?.weightGrams).toBe(2147483647);

    await store.close();
  });

  it('keeps the artifact bag volume, whole and fractional', async () => {
    const store = await openTestStore();

    const bag = await store.repository.createItem(
      newItem({
        categoryId: 'packs',
        name: ARTIFACT.bag.name,
        weightGrams: 2400,
        litreVolume: 113,
      }),
    );
    const half = await store.repository.createItem(
      newItem({
        categoryId: 'packs',
        name: 'Half-full duffel',
        weightGrams: 900,
        litreVolume: 113.5,
      }),
    );

    expect((await store.repository.getItem(bag.id))?.litreVolume).toBe(113);
    expect((await store.repository.getItem(half.id))?.litreVolume).toBe(113.5);

    await store.close();
  });
});

describe('editing and deleting an item (S1-11, S1-15)', () => {
  it('edits one field and leaves the rest of the row alone', async () => {
    const store = await openTestStore();

    const created = await store.repository.createItem(
      newItem({ categoryId: 'pouches', name: ARTIFACT.bipod.name, weightGrams: 230 }),
    );
    const edited = must(
      await store.repository.updateItem(created.id, { weightGrams: 245 }),
    );

    // `updatedAt` has its own test below; everything else must be untouched.
    expect({ ...edited, updatedAt: created.updatedAt }).toEqual({
      ...created,
      weightGrams: 245,
    });

    await store.close();
  });

  it('moves updatedAt forward and leaves createdAt where it was', async () => {
    const store = await openTestStore();

    const created = await store.repository.createItem(newItem({ name: 'Javelin Pro' }));
    await sleep(5);
    const once = must(
      await store.repository.updateItem(created.id, { weightGrams: 245 }),
    );
    await sleep(5);
    const twice = must(
      await store.repository.updateItem(created.id, { brand: 'Javelin' }),
    );

    expect(Date.parse(twice.updatedAt)).toBeGreaterThan(Date.parse(once.updatedAt));
    expect(twice.createdAt).toBe(created.createdAt);
    expect(twice.brand).toBe('Javelin');
    // The earlier edit was persisted, not lost by the second.
    expect(twice.weightGrams).toBe(245);

    await store.close();
  });

  it('edits a consumable into a boxed one and back out again', async () => {
    const store = await openTestStore();

    const created = await store.repository.createItem(
      newItem({
        categoryId: 'food',
        name: 'Dinner',
        isConsumable: true,
        weightGrams: 190,
      }),
    );
    const boxed = must(
      await store.repository.updateItem(created.id, {
        packWeightGrams: 3000,
        unitsPerPack: 6,
      }),
    );
    const unboxed = must(
      await store.repository.updateItem(created.id, {
        packWeightGrams: null,
        unitsPerPack: null,
      }),
    );

    expect(resolveUnitWeight(boxed).grams).toBe(500);
    expect(resolveUnitWeight(unboxed).grams).toBe(190);
    expect(unboxed.packWeightGrams).toBeNull();
    expect(unboxed.unitsPerPack).toBeNull();

    await store.close();
  });

  it('returns null when editing an item that is not there', async () => {
    const store = await openTestStore();

    expect(
      await store.repository.updateItem('00000000-0000-4000-8000-000000000000', {
        name: 'x',
      }),
    ).toBeNull();

    await store.close();
  });

  it('deletes an item and the item after it is gone', async () => {
    const store = await openTestStore();

    const created = await store.repository.createItem(
      newItem({ name: 'Spare bootlace' }),
    );
    await store.repository.deleteItem(created.id);

    expect(await store.repository.getItem(created.id)).toBeNull();
    expect(await store.repository.listItems()).toHaveLength(0);

    await store.close();
  });

  it('deleting something that was never there is a no-op, not a crash', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(newItem({ name: 'Tikka T3x Lite' }));

    await store.repository.deleteItem('00000000-0000-4000-8000-000000000000');

    expect((await store.repository.getItem(rifle.id))?.name).toBe('Tikka T3x Lite');

    await store.close();
  });
});

describe('listing and filtering items (S1-10, S1-14)', () => {
  async function seed(store: TestStore): Promise<void> {
    // Added in an order that is neither alphabetical nor the display order.
    await store.repository.createItem(
      newItem({ categoryId: 'footwear', name: 'Hiking boots', weightGrams: 2100 }),
    );
    await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: 'Tikka T3x Lite', weightGrams: 2900 }),
    );
    await store.repository.createItem(
      newItem({ categoryId: 'optics', name: 'Leupold VX-5HD', weightGrams: 561 }),
    );
    await store.repository.createItem(
      newItem({ categoryId: 'clothing', name: 'Torrentshell 3L', weightGrams: 290 }),
    );
  }

  it('lists items in the system category order, not in the order they were added', async () => {
    const store = await openTestStore();
    await seed(store);

    const listed = await store.repository.listItems();
    const expectedOrder = SORTED_CATEGORIES.map((category) => category.id).filter((id) =>
      listed.some((entry) => entry.categoryId === id),
    );

    expect(listed.map((entry) => entry.categoryId)).toEqual(expectedOrder);
    // Packs, cooking, sleeping, pouches and accessory hold nothing here.
    expect(listed.map((entry) => entry.categoryId)).toEqual([
      'clothing',
      'firearms',
      'optics',
      'footwear',
    ]);

    await store.close();
  });

  it('sorts items by name within a category', async () => {
    const store = await openTestStore();
    await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: 'Tikka T3x Lite', weightGrams: 2900 }),
    );
    await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: '7mm-08 Rem 140gr' }),
    );
    await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: 'Rangefinder', weightGrams: 210 }),
    );

    expect(
      (await store.repository.listItems({ categoryId: 'firearms' })).map((i) => i.name),
    ).toEqual(['7mm-08 Rem 140gr', 'Rangefinder', 'Tikka T3x Lite']);

    await store.close();
  });

  it('filters to one category', async () => {
    const store = await openTestStore();
    await seed(store);

    const firearms = await store.repository.listItems({ categoryId: 'firearms' });

    expect(firearms.map((entry) => entry.name)).toEqual(['Tikka T3x Lite']);
    expect(firearms.every((entry) => entry.categoryId === 'firearms')).toBe(true);

    await store.close();
  });

  it('returns nothing for a category with nothing in it', async () => {
    const store = await openTestStore();
    await seed(store);

    expect(await store.repository.listItems({ categoryId: 'cooking' })).toEqual([]);

    await store.close();
  });

  it('searches the name without regard to case', async () => {
    const store = await openTestStore();
    await seed(store);

    // Upper and lower, both directions, so the assertion cannot pass by luck.
    expect(
      (await store.repository.listItems({ search: 'TIKKA' })).map((i) => i.name),
    ).toEqual(['Tikka T3x Lite']);
    expect(
      (await store.repository.listItems({ search: 'leupold' })).map((i) => i.name),
    ).toEqual(['Leupold VX-5HD']);

    await store.close();
  });

  it('searches the brand as well as the name', async () => {
    const store = await openTestStore();
    await store.repository.createItem(
      newItem({
        categoryId: 'packs',
        brand: 'Stone Glacier',
        name: 'Sky Talus 6900',
        weightGrams: 2400,
      }),
    );
    await store.repository.createItem(
      newItem({ categoryId: 'pouches', name: 'Talley Lightweight' }),
    );

    expect(
      (await store.repository.listItems({ search: 'stone' })).map((i) => i.name),
    ).toEqual(['Sky Talus 6900']);
    // "Talley" is a brand on one item and a name fragment on another.
    expect(
      (await store.repository.listItems({ search: 'talley' })).map((i) => i.name),
    ).toEqual(['Talley Lightweight']);

    await store.close();
  });

  it('narrows to a category and a search at once', async () => {
    const store = await openTestStore();
    await seed(store);

    expect(
      await store.repository.listItems({ categoryId: 'firearms', search: 'scope' }),
    ).toEqual([]);
    expect(
      (await store.repository.listItems({ categoryId: 'optics', search: 'leupold' })).map(
        (i) => i.name,
      ),
    ).toEqual(['Leupold VX-5HD']);

    await store.close();
  });

  it('returns an empty catalogue rather than nothing at all', async () => {
    const store = await openTestStore();

    expect(await store.repository.listItems()).toEqual([]);

    await store.close();
  });
});

describe('packs (S1-16, S1-17)', () => {
  it('keeps the bag the artifact carried: 2400 g and 113 L', async () => {
    const store = await openTestStore();

    const created = await store.repository.createPack(
      newPack({
        name: ARTIFACT.bag.name,
        type: 'Hunting Pack',
        weightGrams: 2400,
        litreVolume: 113,
      }),
    );
    const read = must(await store.repository.getPack(created.id));

    expect(read.id).toMatch(UUID);
    expect(read.userId).toBe(LOCAL_USER_ID);
    expect(read.name).toBe(ARTIFACT.bag.name);
    expect(read.weightGrams).toBe(2400);
    expect(read.litreVolume).toBe(113);

    await store.close();
  });

  it('keeps a pack with no type and no volume as null, not as an empty string', async () => {
    const store = await openTestStore();

    const created = await store.repository.createPack(
      newPack({ name: 'Day Pack', type: null, weightGrams: 0, litreVolume: null }),
    );
    const read = must(await store.repository.getPack(created.id));

    expect(read.type).toBeNull();
    expect(read.litreVolume).toBeNull();

    await store.close();
  });

  it('reads a pack whose weight was never set as 0 g, because the engine adds it up', async () => {
    const store = await openTestStore();

    // `packs.weight_grams` is nullable in docs/DATA-MODEL.md, but `Pack.weightGrams`
    // is a number, and `summarisePack` adds it straight into base weight. A null
    // here would make the whole base figure null.
    await store.driver.execAsync(
      "insert into packs (id, name) values ('99999999-9999-4999-8999-999999999999', 'Day Pack')",
    );

    expect(
      (await store.repository.getPack('99999999-9999-4999-8999-999999999999'))
        ?.weightGrams,
    ).toBe(0);

    await store.close();
  });

  it('lists packs', async () => {
    const store = await openTestStore();
    await store.repository.createPack(
      newPack({ name: 'Hunting Pack', weightGrams: 2400 }),
    );
    await store.repository.createPack(newPack({ name: 'Day Pack', weightGrams: 900 }));

    expect((await store.repository.listPacks()).map((p) => p.name).sort()).toEqual([
      'Day Pack',
      'Hunting Pack',
    ]);

    await store.close();
  });

  it('edits a pack without disturbing the other one', async () => {
    const store = await openTestStore();
    const hunting = await store.repository.createPack(
      newPack({ name: 'Hunting Pack', weightGrams: 2400 }),
    );
    const day = await store.repository.createPack(
      newPack({ name: 'Day Pack', weightGrams: 900 }),
    );

    const edited = must(
      await store.repository.updatePack(hunting.id, {
        name: 'Alpine Pack',
        weightGrams: 2600,
      }),
    );

    expect({ ...edited, updatedAt: hunting.updatedAt }).toEqual({
      ...hunting,
      name: 'Alpine Pack',
      weightGrams: 2600,
    });
    expect((await store.repository.getPack(day.id))?.name).toBe('Day Pack');

    await store.close();
  });

  it('returns null for a pack that is not there', async () => {
    const store = await openTestStore();

    expect(
      await store.repository.getPack('00000000-0000-4000-8000-000000000000'),
    ).toBeNull();
    expect(
      await store.repository.updatePack('00000000-0000-4000-8000-000000000000', {
        name: 'x',
      }),
    ).toBeNull();

    await store.close();
  });

  it('deleting a pack leaves the other packs and the whole catalogue alone', async () => {
    const store = await openTestStore();
    const hunting = await store.repository.createPack(
      newPack({ name: 'Hunting Pack', weightGrams: 2400 }),
    );
    const day = await store.repository.createPack(
      newPack({ name: 'Day Pack', weightGrams: 900 }),
    );
    const rifle = await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: ARTIFACT.rifle.name, weightGrams: 2900 }),
    );
    await store.repository.addLine({ packId: hunting.id, itemId: rifle.id });

    await store.repository.deletePack(hunting.id);

    const remaining = await store.repository.listPacks();
    expect(remaining.map((p) => p.id)).toEqual([day.id]);
    expect(remaining.map((p) => p.name)).toEqual(['Day Pack']);
    expect(await store.repository.getPack(hunting.id)).toBeNull();
    expect((await store.repository.getItem(rifle.id))?.weightGrams).toBe(2900);

    await store.close();
  });
});

describe('pack lines (S1-19, S1-20, S1-21)', () => {
  async function seedLines(
    store: TestStore,
  ): Promise<{ packId: PackId; itemIds: string[] }> {
    const pack = await store.repository.createPack(
      newPack({ name: 'Hunting Pack', weightGrams: 2400 }),
    );
    const items = [
      { name: ARTIFACT.rifle.name, weightGrams: 2900 },
      { name: ARTIFACT.jacket.name, weightGrams: 290 },
      { name: ARTIFACT.boots.name, weightGrams: 2100 },
    ].map((spec) =>
      store.repository.createItem(
        newItem({ name: spec.name, weightGrams: spec.weightGrams }),
      ),
    );

    const created = await Promise.all(items);
    await store.repository.addLine({
      packId: pack.id,
      itemId: created[0]!.id,
      position: 2,
    });
    await store.repository.addLine({
      packId: pack.id,
      itemId: created[1]!.id,
      position: 0,
    });
    await store.repository.addLine({
      packId: pack.id,
      itemId: created[2]!.id,
      position: 1,
    });

    return { packId: pack.id, itemIds: created.map((item) => item.id) };
  }

  it('defaults a new line to one, unticked, first', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );

    const line = await store.repository.addLine({ packId: pack.id, itemId: rifle.id });

    expect(line.id).toMatch(UUID);
    expect(line.qty).toBe(1);
    expect(line.ticked).toBe(false);
    expect(line.position).toBe(0);

    await store.close();
  });

  it('adds a line with a quantity, a tick state and a position', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const ammo = await store.repository.createItem(
      newItem({
        categoryId: 'firearms',
        name: ARTIFACT.ammo.name,
        isConsumable: true,
        packWeightGrams: 520,
        unitsPerPack: 20,
      }),
    );

    const line = await store.repository.addLine({
      packId: pack.id,
      itemId: ammo.id,
      qty: 20,
      ticked: true,
      position: 3,
    });
    const read = must(await store.repository.getLine(line.id));

    expect(read).toEqual({ ...line, packId: pack.id, itemId: ammo.id });

    await store.close();
  });

  it('lists a pack’s lines in position order whatever order they were added', async () => {
    const store = await openTestStore();
    const { packId, itemIds } = await seedLines(store);

    const lines = await store.repository.listLines(packId);

    expect(lines.map((line) => line.position)).toEqual([0, 1, 2]);
    expect(lines.map((line) => line.itemId)).toEqual([
      itemIds[1],
      itemIds[2],
      itemIds[0],
    ]);

    await store.close();
  });

  it('reorders lines by swapping their positions', async () => {
    const store = await openTestStore();
    const { packId, itemIds } = await seedLines(store);
    const [rifleId, jacketId, bootsId] = itemIds as [string, string, string];
    const lines = await store.repository.listLines(packId);
    const lineFor = (itemId: string) =>
      must(lines.find((line) => line.itemId === itemId));
    // Currently rifle 2, jacket 0, boots 1. Swap the rifle and the jacket.
    await store.repository.updateLine(lineFor(rifleId).id, { position: 0 });
    await store.repository.updateLine(lineFor(jacketId).id, { position: 2 });

    expect((await store.repository.listLines(packId)).map((line) => line.itemId)).toEqual(
      [rifleId, bootsId, jacketId],
    );

    await store.close();
  });

  it('keeps both lines when two of them share a position', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );
    const jacket = await store.repository.createItem(
      newItem({ name: ARTIFACT.jacket.name }),
    );

    await store.repository.addLine({ packId: pack.id, itemId: rifle.id, position: 0 });
    await store.repository.addLine({ packId: pack.id, itemId: jacket.id, position: 0 });

    // A tie is a UI bug, not a reason to drop a line the user packed.
    const lines = await store.repository.listLines(pack.id);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.itemId).sort()).toEqual([rifle.id, jacket.id].sort());

    await store.close();
  });

  it('remembers a tick, and remembers unticking it', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const boots = await store.repository.createItem(
      newItem({ name: ARTIFACT.boots.name }),
    );
    const line = await store.repository.addLine({ packId: pack.id, itemId: boots.id });

    const ticked = must(await store.repository.updateLine(line.id, { ticked: true }));
    expect(ticked.ticked).toBe(true);
    expect((await store.repository.getLine(line.id))?.ticked).toBe(true);

    const unticked = must(await store.repository.updateLine(line.id, { ticked: false }));
    expect(unticked.ticked).toBe(false);
    expect((await store.repository.getLine(line.id))?.ticked).toBe(false);

    await store.close();
  });

  it('changes a quantity without touching the tick or the position', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const ammo = await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: ARTIFACT.ammo.name, isConsumable: true }),
    );
    const line = await store.repository.addLine({
      packId: pack.id,
      itemId: ammo.id,
      qty: 20,
      ticked: true,
      position: 4,
    });

    const changed = must(await store.repository.updateLine(line.id, { qty: 40 }));

    expect(changed).toEqual({ ...line, qty: 40 });
    expect(must(await store.repository.getLine(line.id))).toEqual({ ...line, qty: 40 });

    await store.close();
  });

  it('refuses to put the same item in a pack twice', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );
    await store.repository.addLine({ packId: pack.id, itemId: rifle.id });

    await expect(
      store.repository.addLine({ packId: pack.id, itemId: rifle.id, qty: 5 }),
    ).rejects.toThrow();
    expect(await store.repository.listLines(pack.id)).toHaveLength(1);

    await store.close();
  });

  it('allows the same item in a second pack', async () => {
    const store = await openTestStore();
    const hunting = await store.repository.createPack(newPack({ name: 'Hunting Pack' }));
    const day = await store.repository.createPack(newPack({ name: 'Day Pack' }));
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );

    await store.repository.addLine({ packId: hunting.id, itemId: rifle.id });
    await store.repository.addLine({ packId: day.id, itemId: rifle.id });

    expect(await store.repository.listLines(hunting.id)).toHaveLength(1);
    expect(await store.repository.listLines(day.id)).toHaveLength(1);

    await store.close();
  });

  it('refuses a line on a pack that is not there', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );

    await expect(
      store.repository.addLine({
        packId: '00000000-0000-4000-8000-000000000000',
        itemId: rifle.id,
      }),
    ).rejects.toThrow();
    expect(await store.repository.listItems()).toHaveLength(1);

    await store.close();
  });

  it('refuses a line on an item that is not there', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());

    await expect(
      store.repository.addLine({
        packId: pack.id,
        itemId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow();
    expect(await store.repository.listLines(pack.id)).toHaveLength(0);

    await store.close();
  });

  it('refuses a quantity of zero and a negative quantity', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );

    await expect(
      store.repository.addLine({ packId: pack.id, itemId: rifle.id, qty: 0 }),
    ).rejects.toThrow();
    await expect(
      store.repository.addLine({ packId: pack.id, itemId: rifle.id, qty: -1 }),
    ).rejects.toThrow();
    expect(await store.repository.listLines(pack.id)).toHaveLength(0);

    await store.close();
  });

  it('removes a line and leaves the item in the catalogue', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const rifle = await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: ARTIFACT.rifle.name, weightGrams: 2900 }),
    );
    const line = await store.repository.addLine({ packId: pack.id, itemId: rifle.id });

    await store.repository.deleteLine(line.id);

    expect(await store.repository.getLine(line.id)).toBeNull();
    expect(await store.repository.listLines(pack.id)).toHaveLength(0);
    expect((await store.repository.getItem(rifle.id))?.weightGrams).toBe(2900);

    await store.close();
  });

  it('returns null for a line that is not there', async () => {
    const store = await openTestStore();

    expect(
      await store.repository.getLine('00000000-0000-4000-8000-000000000000'),
    ).toBeNull();

    await store.close();
  });
});

describe('linked gear (S1-26)', () => {
  it('stores the artifact linked gear: a rifle implies its scope, rings and bipod', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: ARTIFACT.rifle.name, weightGrams: 2900 }),
    );
    const scope = await store.repository.createItem(
      newItem({ categoryId: 'optics', name: ARTIFACT.scope.name, weightGrams: 561 }),
    );
    const rings = await store.repository.createItem(
      newItem({ categoryId: 'optics', name: ARTIFACT.rings.name, weightGrams: 57 }),
    );
    const bipod = await store.repository.createItem(
      newItem({ categoryId: 'pouches', name: ARTIFACT.bipod.name, weightGrams: 230 }),
    );

    await store.repository.addItemLink(rifle.id, scope.id);
    await store.repository.addItemLink(rifle.id, rings.id);
    await store.repository.addItemLink(rifle.id, bipod.id);

    expect((await store.repository.listLinkedItemIds(rifle.id)).sort()).toEqual(
      [bipod.id, rings.id, scope.id].sort(),
    );

    await store.close();
  });

  it('reads a link from the item that implies it, not the other way round', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );
    const scope = await store.repository.createItem(
      newItem({ name: ARTIFACT.scope.name }),
    );

    await store.repository.addItemLink(rifle.id, scope.id);

    expect(await store.repository.listLinkedItemIds(rifle.id)).toEqual([scope.id]);
    // A scope does not imply a rifle, so nothing is implied from the scope.
    expect(await store.repository.listLinkedItemIds(scope.id)).toEqual([]);

    await store.close();
  });

  it('refuses an item linked to itself', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );

    await expect(store.repository.addItemLink(rifle.id, rifle.id)).rejects.toThrow();
    expect(await store.repository.getItemLinks()).toEqual({});

    await store.close();
  });

  it('refuses a link to an item that is not there', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );

    await expect(
      store.repository.addItemLink(rifle.id, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow();
    expect(await store.repository.getItemLinks()).toEqual({});

    await store.close();
  });

  it('removes a link', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );
    const scope = await store.repository.createItem(
      newItem({ name: ARTIFACT.scope.name }),
    );
    await store.repository.addItemLink(rifle.id, scope.id);

    await store.repository.removeItemLink(rifle.id, scope.id);

    expect(await store.repository.listLinkedItemIds(rifle.id)).toEqual([]);

    await store.close();
  });

  it('hands the weight engine the whole link map in one read', async () => {
    const store = await openTestStore();
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );
    const scope = await store.repository.createItem(
      newItem({ name: ARTIFACT.scope.name }),
    );
    const rings = await store.repository.createItem(
      newItem({ name: ARTIFACT.rings.name }),
    );
    const unrelated = await store.repository.createItem(
      newItem({ name: 'Torrentshell 3L' }),
    );
    await store.repository.addItemLink(rifle.id, scope.id);
    await store.repository.addItemLink(rifle.id, rings.id);

    const links = await store.repository.getItemLinks();

    expect(Object.keys(links)).toEqual([rifle.id]);
    expect(links[rifle.id]?.slice().sort()).toEqual([rings.id, scope.id].sort());
    expect([...collectLinkedItemIds([rifle.id], links)].sort()).toEqual(
      [rings.id, scope.id].sort(),
    );
    // The unlinked jacket is not swept in.
    expect([...collectLinkedItemIds([rifle.id, unrelated.id], links)]).not.toContain(
      unrelated.id,
    );

    await store.close();
  });

  it('has no links at all on a fresh catalogue', async () => {
    const store = await openTestStore();
    await store.repository.createItem(newItem({ name: ARTIFACT.rifle.name }));

    expect(await store.repository.getItemLinks()).toEqual({});
    expect(await store.repository.listLinkedItemIds('anything')).toEqual([]);

    await store.close();
  });

  it('terminates on a two-node cycle instead of hanging the rollup', async () => {
    const store = await openTestStore();
    const a = await store.repository.createItem(newItem({ name: 'A' }));
    const b = await store.repository.createItem(newItem({ name: 'B' }));

    await store.repository.addItemLink(a.id, b.id);
    await store.repository.addItemLink(b.id, a.id);
    const links = await store.repository.getItemLinks();

    // A hang here fails on the jest timeout rather than an assertion, which is
    // the right failure: S1-26's link editor must not be able to deadlock a pack.
    expect([...collectLinkedItemIds([a.id], links)]).toEqual([b.id]);
    expect([...collectLinkedItemIds([b.id], links)]).toEqual([a.id]);

    await store.close();
  });
});

describe('the pack screen read (S1-18)', () => {
  it('fetches linked items it was given ids for, in one query', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);
    const stored = await readPackFromStore(store.repository, packId);
    const scope = must(
      [...stored.itemsById.values()].find((item) => item.name === ARTIFACT.scope.name),
    );

    store.driver.resetLog();
    const found = await store.repository.getItemsByIds([scope.id]);

    // One statement for any number of ids: the pack screen cannot afford a
    // round trip per linked item.
    expect(store.driver.countMatching(/\bfrom items\b/i)).toBe(1);
    expect(found.map((item) => item.name)).toEqual([ARTIFACT.scope.name]);
    expect(found[0]?.weightGrams).toBe(561);
  });

  it('returns an empty list for an empty id list rather than querying nothing', async () => {
    const store = await openTestStore();
    await seedArtifactPack(store.repository);

    store.driver.resetLog();
    expect(await store.repository.getItemsByIds([])).toEqual([]);
    expect(store.driver.countMatching(/\bfrom items\b/i)).toBe(0);
  });

  it('skips ids that are not there instead of inventing a row', async () => {
    const store = await openTestStore();
    await seedArtifactPack(store.repository);
    const rifle = must(
      (await store.repository.listItems({ categoryId: 'firearms' })).find(
        (item) => item.name === ARTIFACT.rifle.name,
      ),
    );

    expect(await store.repository.getItemsByIds([rifle.id, 'no-such-item'])).toEqual([
      rifle,
    ]);
  });

  it('gives each line its own id, not the id of the item it points at', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);

    const contents = await store.repository.getPackContents(packId);
    const stored = await store.repository.listLines(packId);

    // A joined read that lets `i.id` overwrite `l.id` hands back the item id and
    // every later edit and tick lands on nothing.
    for (const entry of contents) {
      expect(entry.id).toMatch(UUID);
      expect(entry.id).not.toBe(entry.itemId);
      expect(entry.id).toBe(must(stored.find((line) => line.itemId === entry.itemId)).id);
    }
    expect(new Set(contents.map((entry) => entry.id)).size).toBe(contents.length);

    await store.close();
  });

  it('returns every line with the item it points at', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);

    const contents = await store.repository.getPackContents(packId);

    expect(contents).toHaveLength(5);
    expect(contents.map((entry) => entry.item.name).sort()).toEqual(
      [
        ARTIFACT.rifle.name,
        ARTIFACT.jacket.name,
        ARTIFACT.boots.name,
        ARTIFACT.meals.name,
        ARTIFACT.ammo.name,
      ].sort(),
    );
    const rifle = must(contents.find((entry) => entry.item.name === ARTIFACT.rifle.name));
    expect(rifle.item.categoryId).toBe('firearms');
    expect(rifle.item.weightGrams).toBe(2900);
    expect(rifle.qty).toBe(1);
    expect(rifle.ticked).toBe(false);

    await store.close();
  });

  it('reads the whole pack in one query, not one per line', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);

    store.driver.resetLog();
    const contents = await store.repository.getPackContents(packId);

    expect(contents).toHaveLength(5);
    expect(store.driver.statements).toHaveLength(1);
    expect(store.driver.statements[0]).toMatch(/\bjoin\b/i);

    await store.close();
  });

  it('returns the lines in position order', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);

    const contents = await store.repository.getPackContents(packId);

    expect(contents.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 4]);

    await store.close();
  });

  it('is empty for a pack with nothing in it', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(
      newPack({ name: 'Empty', weightGrams: 2400 }),
    );

    expect(await store.repository.getPackContents(pack.id)).toEqual([]);

    await store.close();
  });

  it('is empty for a pack that is not there', async () => {
    const store = await openTestStore();

    expect(
      await store.repository.getPackContents('00000000-0000-4000-8000-000000000000'),
    ).toEqual([]);

    await store.close();
  });

  it('leaves no line behind after the item is deleted', async () => {
    const store = await openTestStore();
    const pack = await store.repository.createPack(newPack());
    const rifle = await store.repository.createItem(
      newItem({ name: ARTIFACT.rifle.name }),
    );
    await store.repository.addLine({ packId: pack.id, itemId: rifle.id });

    await store.repository.deleteItem(rifle.id);

    // A line pointing at a missing item would be reported by the weight engine as
    // a missing id, which is a data problem the user cannot see or fix.
    expect(await store.repository.getPackContents(pack.id)).toEqual([]);

    await store.close();
  });
});

describe('a pack weighs the same before and after storage (R7)', () => {
  /**
   * Hand-computed from the artifact's own rows:
   *   base        bag 2400 + rifle 2900 + jacket 290            = 5590
   *   worn        boots                                         = 2100
   *   consumables meals 4 x 190 + 7mm-08 20 x 26                = 760 + 520 = 1280
   *   contents                                                   = 8970
   *   linked      scope 561 + rings 57 + bipod 230              = 848
   *   total                                                   = 9818
   */
  const EXPECTED = {
    baseGrams: 5590,
    wornGrams: 2100,
    consumablesGrams: 1280,
    contentsGrams: 8970,
    linkedGrams: 848,
    totalGrams: 9818,
  };

  it('splits base, worn and consumables the same way from stored rows', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);

    const stored = await readPackFromStore(store.repository, packId);

    expect(summarisePack(stored)).toEqual({ ...EXPECTED, missingItemIds: [] });

    await store.close();
  });

  it('reproduces the artifact linked-gear rollup from stored rows: 3748 g', async () => {
    const store = await openTestStore();
    const bag = await store.repository.createPack(
      newPack({ name: ARTIFACT.bag.name, weightGrams: 0 }),
    );
    const rifle = await store.repository.createItem(
      newItem({ categoryId: 'firearms', name: ARTIFACT.rifle.name, weightGrams: 2900 }),
    );
    for (const spec of [ARTIFACT.scope, ARTIFACT.rings, ARTIFACT.bipod]) {
      const linked = await store.repository.createItem(
        newItem({ name: spec.name, weightGrams: spec.weightGrams }),
      );
      await store.repository.addItemLink(rifle.id, linked.id);
    }
    await store.repository.addLine({ packId: bag.id, itemId: rifle.id });

    const summary = summarisePack(await readPackFromStore(store.repository, bag.id));

    expect(summary.contentsGrams).toBe(2900);
    expect(summary.linkedGrams).toBe(848);
    expect(summary.totalGrams).toBe(3748);

    await store.close();
  });

  it('reads 20 rounds of 7mm-08 as 520 g from storage, not as 20 units of 0 g', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);
    const stored = await readPackFromStore(store.repository, packId);
    const ammo = must(
      stored.contents.find((entry) => entry.item.name === ARTIFACT.ammo.name),
    );

    expect(ammo.item.packWeightGrams).toBe(520);
    expect(ammo.item.unitsPerPack).toBe(20);
    expect(resolveUnitWeight(ammo.item).grams).toBe(26);
    expect(ammo.qty).toBe(20);

    await store.close();
  });

  it('still sums to the stored total, category by category', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);
    const stored = await readPackFromStore(store.repository, packId);

    const rows = categoryBreakdown(stored);
    const summary = summarisePack(stored);

    expect(rows.reduce((acc, row) => acc + row.totalGrams, 0)).toBe(summary.totalGrams);
    expect(rows.reduce((acc, row) => acc + row.baseGrams, 0)).toBe(summary.baseGrams);
    expect(rows.reduce((acc, row) => acc + row.wornGrams, 0)).toBe(summary.wornGrams);
    expect(rows.reduce((acc, row) => acc + row.consumablesGrams, 0)).toBe(
      summary.consumablesGrams,
    );
    expect(rows.reduce((acc, row) => acc + row.linkedGrams, 0)).toBe(summary.linkedGrams);

    await store.close();
  });

  it('still puts the bag under Packs and the linked gear under its own categories', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);
    const stored = await readPackFromStore(store.repository, packId);

    const rows = categoryBreakdown(stored);

    expect(must(rows.find((row) => row.categoryId === 'packs')).baseGrams).toBe(2400);
    expect(must(rows.find((row) => row.categoryId === 'optics')).linkedGrams).toBe(618);
    expect(must(rows.find((row) => row.categoryId === 'pouches')).linkedGrams).toBe(230);
    // Linked gear is never counted in the category of the item that implies it.
    expect(must(rows.find((row) => row.categoryId === 'firearms')).linkedGrams).toBe(0);

    await store.close();
  });

  it('counts worn weight as worn, not as base, once it has been through storage', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);
    const stored = await readPackFromStore(store.repository, packId);
    const boots = must(
      stored.contents.find((entry) => entry.item.name === ARTIFACT.boots.name),
    );

    expect(boots.item.isWorn).toBe(true);
    expect(
      must(categoryBreakdown(stored).find((row) => row.categoryId === 'footwear'))
        .baseGrams,
    ).toBe(0);
    expect(
      must(categoryBreakdown(stored).find((row) => row.categoryId === 'footwear'))
        .wornGrams,
    ).toBe(2100);

    await store.close();
  });

  it('weighs the same pack in memory and after a round trip', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);

    const fromMemory = summarisePack(artifactPackInMemory());
    const fromStorage = summarisePack(await readPackFromStore(store.repository, packId));

    // The strongest form of R7: storage is invisible to the number. If any
    // column lost a sign, a null, a flag or a gram, these two differ.
    expect(fromStorage).toEqual(fromMemory);
    expect(fromStorage.totalGrams).toBe(9818);

    await store.close();
  });

  it('does not double count a linked item the user also packed', async () => {
    const store = await openTestStore();
    const packId = await seedArtifactPack(store.repository);
    const stored = await readPackFromStore(store.repository, packId);
    // The scope is linked gear, not a line, so it has to come from the linked
    // items rather than from the pack contents.
    const scope = must(
      [...stored.itemsById.values()].find((item) => item.name === ARTIFACT.scope.name),
    );
    await store.repository.addLine({ packId, itemId: scope.id, position: 5 });

    const summary = summarisePack(await readPackFromStore(store.repository, packId));

    expect(summary.contentsGrams).toBe(8970 + 561);
    expect(summary.linkedGrams).toBe(848 - 561);

    await store.close();
  });
});

describe('reopening the database', () => {
  it('keeps the whole pack, ticks and all, after a restart', async () => {
    const first = await openTestStore();
    const packId = await seedArtifactPack(first.repository);
    const rifleLine = await rifleLineIn(first.repository, packId);
    await first.repository.updateLine(rifleLine.id, { ticked: true });
    await first.close();

    // The database has to be a file for this test to mean anything.
    expect(databaseFileExists(first.path)).toBe(true);

    const second = await openTestStore({ path: first.path });
    const after = await readPackFromStore(second.repository, packId);
    const lines = await second.repository.listLines(packId);

    expect(summarisePack(after)).toEqual({
      ...summarisePack(artifactPackInMemory()),
      missingItemIds: [],
    });
    expect(lines.map((line) => line.position)).toEqual([0, 1, 2, 3, 4]);
    expect(lines.filter((line) => line.ticked).map((line) => line.id)).toEqual([
      rifleLine.id,
    ]);
    expect((await second.repository.getItemLinks())[rifleLine.itemId] ?? []).toHaveLength(
      3,
    );

    await second.close();
  });

  it('keeps every weight exact after a restart', async () => {
    const first = await openTestStore();
    const rifle = await first.repository.createItem(
      newItem({ categoryId: 'firearms', name: ARTIFACT.rifle.name, weightGrams: 2900 }),
    );
    const ammo = await first.repository.createItem(
      newItem({
        categoryId: 'firearms',
        name: ARTIFACT.ammo.name,
        isConsumable: true,
        packWeightGrams: 520,
        unitsPerPack: 20,
      }),
    );
    const placeholder = await first.repository.createItem(
      newItem({ name: 'To be weighed', weightGrams: 0 }),
    );
    const heaviest = await first.repository.createItem(
      newItem({ name: 'Anvil', weightGrams: 2147483647 }),
    );
    await first.close();

    const second = await openTestStore({ path: first.path });

    expect((await second.repository.getItem(rifle.id))?.weightGrams).toBe(2900);
    const readAmmo = must(await second.repository.getItem(ammo.id));
    expect([readAmmo.packWeightGrams, readAmmo.unitsPerPack]).toEqual([520, 20]);
    expect(resolveUnitWeight(readAmmo).grams).toBe(26);
    expect((await second.repository.getItem(placeholder.id))?.weightGrams).toBe(0);
    expect((await second.repository.getItem(heaviest.id))?.weightGrams).toBe(2147483647);

    await second.close();
  });

  it('keeps positions and ticks after a restart', async () => {
    const first = await openTestStore();
    const pack = await first.repository.createPack(newPack({ name: 'Hunting Pack' }));
    const a = await first.repository.createItem(newItem({ name: 'A', weightGrams: 100 }));
    const b = await first.repository.createItem(newItem({ name: 'B', weightGrams: 200 }));
    const lineA = await first.repository.addLine({
      packId: pack.id,
      itemId: a.id,
      position: 7,
      ticked: true,
    });
    await first.repository.addLine({ packId: pack.id, itemId: b.id, position: 3 });
    await first.close();

    const second = await openTestStore({ path: first.path });
    const lines = await second.repository.listLines(pack.id);

    expect(lines.map((line) => [line.itemId, line.position, line.ticked])).toEqual([
      [b.id, 3, false],
      [a.id, 7, true],
    ]);
    expect((await second.repository.getLine(lineA.id))?.ticked).toBe(true);

    await second.close();
  });
});
