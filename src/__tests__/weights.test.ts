import {
  categoryBreakdown,
  collectLinkedItemIds,
  lineGrams,
  resolveUnitWeight,
  seedFromMustHaves,
  summarisePack,
} from '@/lib/weights';
import type { GearItem, ItemLinks, Pack, PackId, PackLine } from '@/types/gear';

/**
 * The weight engine is the one thing in this app that must never be wrong, and
 * a wrong total is invisible until a user trusts it. These tests pin the
 * behaviour against figures taken from the original artifact, not invented ones.
 */

const USER = 'user-1';

let seq = 0;
function item(overrides: Partial<GearItem> = {}): GearItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    userId: USER,
    categoryId: 'accessory',
    brand: null,
    name: `Item ${seq}`,
    weightGrams: 0,
    isConsumable: false,
    packWeightGrams: null,
    unitsPerPack: null,
    isWorn: false,
    litreVolume: null,
    mustHave: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function pack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pack-1',
    userId: USER,
    name: 'Hunting Pack',
    type: 'Hunting Pack',
    weightGrams: 0,
    litreVolume: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let lineSeq = 0;
function line(itemId: string, qty = 1): PackLine {
  lineSeq += 1;
  return {
    id: `line-${lineSeq}`,
    packId: 'pack-1' as PackId,
    itemId,
    qty,
    ticked: false,
    position: lineSeq,
  };
}

function index(items: GearItem[]): ReadonlyMap<string, GearItem> {
  return new Map(items.map((entry) => [entry.id, entry]));
}

const NO_LINKS: ItemLinks = {};

describe('resolveUnitWeight', () => {
  it('uses the item weight for ordinary gear', () => {
    expect(resolveUnitWeight(item({ weightGrams: 561 })).grams).toBe(561);
  });

  it('treats a consumable weight as per piece', () => {
    // Artifact: "Clif Chocolate Chip — 68 g ea."
    expect(resolveUnitWeight(item({ isConsumable: true, weightGrams: 68 })).grams).toBe(
      68,
    );
  });

  it('divides a box weight by its unit count', () => {
    // Artifact: "7mm-08 140gr — 26 g ea.", 20 rounds to a box.
    expect(
      resolveUnitWeight(
        item({ isConsumable: true, packWeightGrams: 520, unitsPerPack: 20 }),
      ),
    ).toEqual({
      grams: 26,
      countedIn: 'unit',
      perBoxGrams: 520,
      unitsPerPack: 20,
    });
  });

  it('rounds a box division half up, to the nearest gram', () => {
    expect(
      resolveUnitWeight(
        item({ isConsumable: true, packWeightGrams: 500, unitsPerPack: 3 }),
      ).grams,
    ).toBe(167);
  });

  it('counts boxes when a box weight is given with no unit count', () => {
    expect(
      resolveUnitWeight(
        item({ isConsumable: true, packWeightGrams: 1200, unitsPerPack: null }),
      ),
    ).toEqual({
      grams: 1200,
      countedIn: 'box',
      perBoxGrams: 1200,
      unitsPerPack: null,
    });
  });

  it('ignores a box weight on a non-consumable', () => {
    // A tent's "box weight" is meaningless; its own weight is the weight.
    expect(
      resolveUnitWeight(item({ weightGrams: 1400, packWeightGrams: 2000 })).grams,
    ).toBe(1400);
  });

  it('treats a zero unit count as no unit count', () => {
    expect(
      resolveUnitWeight(
        item({ isConsumable: true, packWeightGrams: 900, unitsPerPack: 0 }),
      ).countedIn,
    ).toBe('box');
  });
});

describe('lineGrams', () => {
  it('multiplies the unit weight by quantity', () => {
    const ammo = item({ isConsumable: true, packWeightGrams: 520, unitsPerPack: 20 });
    expect(lineGrams(ammo, line(ammo.id, 20))).toBe(520);
  });

  it('treats qty as boxes when counted in boxes', () => {
    const meals = item({ isConsumable: true, packWeightGrams: 3000 });
    expect(lineGrams(meals, line(meals.id, 3))).toBe(9000);
  });
});

describe('collectLinkedItemIds', () => {
  it('finds directly linked items', () => {
    const links: ItemLinks = { rifle: ['scope'] };
    expect([...collectLinkedItemIds(['rifle'], links)]).toEqual(['scope']);
  });

  it('follows links transitively', () => {
    const links: ItemLinks = { a: ['b'], b: ['c'], c: ['d'] };
    expect([...collectLinkedItemIds(['a'], links)]).toEqual(['b', 'c', 'd']);
  });

  it('de-duplicates items reachable by more than one path', () => {
    const links: ItemLinks = { a: ['b', 'c'], b: ['d'], c: ['d'] };
    expect([...collectLinkedItemIds(['a'], links)]).toEqual(['b', 'c', 'd']);
  });

  it('excludes items already on the pack', () => {
    const links: ItemLinks = { rifle: ['scope'] };
    expect([...collectLinkedItemIds(['rifle', 'scope'], links)]).toEqual([]);
  });

  it('terminates on a cycle', () => {
    const links: ItemLinks = { a: ['b'], b: ['a'] };
    expect([...collectLinkedItemIds(['a'], links)]).toEqual(['b']);
  });

  it('tolerates a self-link', () => {
    expect([...collectLinkedItemIds(['a'], { a: ['a'] })]).toEqual([]);
  });

  it('ignores an item with no links', () => {
    expect([...collectLinkedItemIds(['a'], NO_LINKS)]).toEqual([]);
  });
});

describe('summarisePack', () => {
  it('reproduces the artifact linked-gear rollup exactly', () => {
    // Artifact: Tikka T3x Lite reads "2.9 kg" with "With linked gear 3.75 kg"
    // covering the Leupold scope, the Talley rings and the Javelin bipod.
    const rifle = item({ name: 'Tikka T3x Lite', weightGrams: 2900 });
    const scope = item({ name: 'Leupold VX-5HD', weightGrams: 561 });
    const rings = item({ name: 'Talley Lightweight', weightGrams: 57 });
    const bipod = item({ name: 'Javelin Pro', weightGrams: 230 });
    const links: ItemLinks = { [rifle.id]: [scope.id, rings.id, bipod.id] };
    const items = [rifle, scope, rings, bipod];

    const summary = summarisePack({
      pack: pack(),
      lines: [line(rifle.id)],
      itemsById: index(items),
      links,
    });

    expect(summary.contentsGrams).toBe(2900);
    expect(summary.linkedGrams).toBe(848);
    expect(summary.totalGrams).toBe(3748);
    // 3748 g is what the artifact rendered as "3.75 kg".
    expect(Math.round(summary.totalGrams / 10) / 100).toBe(3.75);
  });

  it('includes the bag in base weight', () => {
    // Artifact: "Stone Glacier Sky Talus 6900 — 2.4 kg".
    const summary = summarisePack({
      pack: pack({ weightGrams: 2400 }),
      lines: [],
      itemsById: index([]),
      links: NO_LINKS,
    });

    expect(summary.baseGrams).toBe(2400);
    expect(summary.totalGrams).toBe(2400);
  });

  it('splits base, worn and consumables', () => {
    const base = item({ weightGrams: 1200 });
    const worn = item({ weightGrams: 300, isWorn: true });
    const food = item({ isConsumable: true, weightGrams: 185 });

    const summary = summarisePack({
      pack: pack({ weightGrams: 2400 }),
      lines: [line(base.id), line(worn.id), line(food.id, 2)],
      itemsById: index([base, worn, food]),
      links: NO_LINKS,
    });

    expect(summary.baseGrams).toBe(3600); // bag + base
    expect(summary.wornGrams).toBe(300);
    expect(summary.consumablesGrams).toBe(370);
    expect(summary.contentsGrams).toBe(4270);
    expect(summary.totalGrams).toBe(4270);
  });

  it('counts a worn item as worn even if also flagged consumable', () => {
    const ambiguous = item({ weightGrams: 100, isWorn: true, isConsumable: true });
    const summary = summarisePack({
      pack: pack(),
      lines: [line(ambiguous.id)],
      itemsById: index([ambiguous]),
      links: NO_LINKS,
    });

    expect(summary.wornGrams).toBe(100);
    expect(summary.consumablesGrams).toBe(0);
  });

  it('does not double-count a linked item that is also on the pack', () => {
    const rifle = item({ weightGrams: 2900 });
    const scope = item({ weightGrams: 561 });
    const links: ItemLinks = { [rifle.id]: [scope.id] };
    const items = [rifle, scope];

    const summary = summarisePack({
      pack: pack(),
      lines: [line(rifle.id), line(scope.id)],
      itemsById: index(items),
      links,
    });

    expect(summary.contentsGrams).toBe(3461);
    expect(summary.linkedGrams).toBe(0);
  });

  it('reports a line whose item has gone missing instead of throwing', () => {
    const summary = summarisePack({
      pack: pack({ weightGrams: 2400 }),
      lines: [line('ghost')],
      itemsById: index([]),
      links: NO_LINKS,
    });

    expect(summary.missingItemIds).toEqual(['ghost']);
    expect(summary.totalGrams).toBe(2400);
  });

  it('reports a dangling link target', () => {
    const rifle = item({ weightGrams: 2900 });
    const links: ItemLinks = { [rifle.id]: ['vanished'] };

    const summary = summarisePack({
      pack: pack(),
      lines: [line(rifle.id)],
      itemsById: index([rifle]),
      links,
    });

    expect(summary.missingItemIds).toEqual(['vanished']);
    expect(summary.linkedGrams).toBe(0);
  });

  it('keeps the total equal to the sum of displayed lines (S1-09)', () => {
    // 3 boxes of 500 g of a 3-per-box consumable: per-unit rounds to 167 g, so
    // the displayed lines read 167 each. The total must be 501, not 500.
    const snack = item({ isConsumable: true, packWeightGrams: 500, unitsPerPack: 3 });
    const lines = [line(snack.id, 3)];
    const itemsById = index([snack]);

    const perLine = lines.reduce((sum, entry) => sum + lineGrams(snack, entry), 0);

    expect(perLine).toBe(501);
    expect(
      summarisePack({ pack: pack(), lines, itemsById, links: NO_LINKS }).totalGrams,
    ).toBe(perLine);
  });

  it('handles an empty pack', () => {
    const summary = summarisePack({
      pack: pack({ weightGrams: 1100 }),
      lines: [],
      itemsById: index([]),
      links: NO_LINKS,
    });

    expect(summary.contentsGrams).toBe(1100);
    expect(summary.linkedGrams).toBe(0);
    expect(summary.totalGrams).toBe(1100);
  });
});

describe('categoryBreakdown', () => {
  const build = () => {
    const bag = pack({ weightGrams: 2400 });
    const rifle = item({ categoryId: 'firearms', weightGrams: 2900 });
    const scope = item({ categoryId: 'optics', weightGrams: 561 });
    const jacket = item({ categoryId: 'clothing', weightGrams: 290 });
    const boots = item({ categoryId: 'footwear', weightGrams: 2100, isWorn: true });
    const meals = item({ categoryId: 'food', isConsumable: true, weightGrams: 190 });
    const links: ItemLinks = { [rifle.id]: [scope.id] };
    const items = [rifle, scope, jacket, boots, meals];

    return {
      pack: bag,
      lines: [line(rifle.id), line(jacket.id), line(boots.id), line(meals.id, 4)],
      itemsById: index(items),
      links,
    };
  };

  it('puts the bag under the packs category', () => {
    const rows = categoryBreakdown(build());
    const packs = rows.find((row) => row.categoryId === 'packs');
    expect(packs?.baseGrams).toBe(2400);
  });

  it('attributes linked gear to its own category, not the parent', () => {
    const rows = categoryBreakdown(build());
    expect(rows.find((row) => row.categoryId === 'optics')?.linkedGrams).toBe(561);
    expect(rows.find((row) => row.categoryId === 'firearms')?.linkedGrams).toBe(0);
  });

  it('omits categories with nothing in them', () => {
    expect(categoryBreakdown(build()).map((row) => row.categoryId)).not.toContain(
      'cooking',
    );
  });

  it('sums to the summary total (R7 invariant)', () => {
    const input = build();
    const rows = categoryBreakdown(input);
    const summary = summarisePack(input);

    expect(rows.reduce((acc, row) => acc + row.totalGrams, 0)).toBe(summary.totalGrams);
    expect(rows.reduce((acc, row) => acc + row.baseGrams, 0)).toBe(summary.baseGrams);
    expect(rows.reduce((acc, row) => acc + row.wornGrams, 0)).toBe(summary.wornGrams);
    expect(rows.reduce((acc, row) => acc + row.consumablesGrams, 0)).toBe(
      summary.consumablesGrams,
    );
    expect(rows.reduce((acc, row) => acc + row.linkedGrams, 0)).toBe(summary.linkedGrams);
  });

  it('is in category order', () => {
    const ids = categoryBreakdown(build()).map((row) => row.categoryId);
    const sorted = [...ids].sort(
      (a, b) =>
        [
          'packs',
          'clothing',
          'firearms',
          'optics',
          'food',
          'cooking',
          'sleeping',
          'footwear',
          'pouches',
          'accessory',
        ].indexOf(a) -
        [
          'packs',
          'clothing',
          'firearms',
          'optics',
          'food',
          'cooking',
          'sleeping',
          'footwear',
          'pouches',
          'accessory',
        ].indexOf(b),
    );
    expect(ids).toEqual(sorted);
  });
});

describe('seedFromMustHaves', () => {
  it('includes must-have items and their linked gear', () => {
    const rifle = item({ name: 'rifle', mustHave: true });
    const scope = item({ name: 'scope' });
    const unrelated = item({ name: 'unrelated' });
    const links: ItemLinks = { [rifle.id]: [scope.id] };

    const seeded = seedFromMustHaves([rifle, scope, unrelated], links);

    expect(seeded.map((entry) => entry.itemId)).toEqual([rifle.id, scope.id]);
  });

  it('is empty when nothing is a must-have', () => {
    expect(seedFromMustHaves([item()], NO_LINKS)).toEqual([]);
  });

  it('assigns sequential positions for the caller to renumber', () => {
    const a = item({ mustHave: true });
    const b = item({ mustHave: true });
    const seeded = seedFromMustHaves([a, b], NO_LINKS);

    expect(seeded.map((entry) => entry.position)).toEqual([0, 1]);
    expect(seeded.every((entry) => entry.qty === 1 && !entry.ticked)).toBe(true);
  });
});
