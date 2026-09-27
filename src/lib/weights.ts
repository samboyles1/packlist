import { CATEGORIES } from '@/data/categories';
import type { GearItem, ItemId, ItemLinks, Pack, PackId, PackLine } from '@/types/gear';

/**
 * The weight engine.
 *
 * This is the only place a pack's weight is computed. The pack screen and the
 * compare screen both call in here, which is the mechanism that stops them
 * disagreeing (risk R7). If a second implementation appears anywhere, that
 * guarantee is gone.
 *
 * Pure and synchronous. No storage, no network, no React. It runs in tests, in
 * the app, and will run unchanged on the server if compare ever needs it.
 *
 * Every figure is integer grams. Rounding happens once, at resolve time for
 * per-unit consumables, and at display time for formatting (D8, S1-09).
 */

/** Round half up, so a displayed total always equals the sum of its lines. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * How a single unit of an item is weighed, and therefore what a line's `qty`
 * counts.
 *
 * Three cases, because consumables are bought by the box but consumed by the
 * piece. The artifact showed all of them: "26 g ea." for ammunition, "68 g ea."
 * for a Clif bar, and a whole box counted once.
 */
export interface ResolvedUnit {
  /** Weight of one `qty` unit, in grams. Already rounded. */
  grams: number;
  /** Whether `qty` counts pieces or boxes. */
  countedIn: 'unit' | 'box';
  /** Weight of the whole box, when the item is boxed. For display as "X g ea." */
  perBoxGrams: number | null;
  /** How many pieces a box holds. */
  unitsPerPack: number | null;
}

export function resolveUnitWeight(item: GearItem): ResolvedUnit {
  // Destructured rather than read off `item` so the null checks actually narrow.
  const { packWeightGrams, unitsPerPack } = item;

  if (packWeightGrams !== null && unitsPerPack !== null && unitsPerPack > 0) {
    return {
      // A box is weighed once; dividing gives the per-piece weight, and rounding
      // here is what keeps `total === sum(displayed lines)` true.
      grams: roundHalfUp(packWeightGrams / unitsPerPack),
      countedIn: 'unit',
      perBoxGrams: packWeightGrams,
      unitsPerPack,
    };
  }

  if (item.isConsumable && packWeightGrams !== null) {
    // Box weight with no unit count: qty counts boxes, each weighing the box.
    return {
      grams: packWeightGrams,
      countedIn: 'box',
      perBoxGrams: packWeightGrams,
      unitsPerPack: null,
    };
  }

  return {
    grams: item.weightGrams,
    countedIn: 'unit',
    perBoxGrams: null,
    unitsPerPack: null,
  };
}

/** Total weight of one pack line. */
export function lineGrams(item: GearItem, line: PackLine): number {
  return resolveUnitWeight(item).grams * line.qty;
}

/**
 * Base / worn / consumable split.
 *
 * Worn wins over consumable when both flags are set. Worn is a pack-weight
 * convention with a specific meaning (it does not count toward your load), and
 * letting a mis-flagged consumable land there would quietly change a total the
 * user is relying on. Both flags on one item is a data error, so the worst
 * outcome is the wrong one being visible rather than the right one being
 * hidden.
 */
function classify(item: GearItem): keyof WeightClass {
  if (item.isWorn) return 'wornGrams';
  if (item.isConsumable) return 'consumablesGrams';
  return 'baseGrams';
}

export interface WeightClass {
  baseGrams: number;
  wornGrams: number;
  consumablesGrams: number;
}

const ZERO: WeightClass = { baseGrams: 0, wornGrams: 0, consumablesGrams: 0 };

function sum(a: WeightClass, b: WeightClass): WeightClass {
  return {
    baseGrams: a.baseGrams + b.baseGrams,
    wornGrams: a.wornGrams + b.wornGrams,
    consumablesGrams: a.consumablesGrams + b.consumablesGrams,
  };
}

function total(weights: WeightClass): number {
  return weights.baseGrams + weights.wornGrams + weights.consumablesGrams;
}

function addTo(
  target: Record<string, WeightClass>,
  key: string,
  value: WeightClass,
): void {
  target[key] = sum(target[key] ?? ZERO, value);
}

/**
 * Everything reachable from the items already on a pack, excluding the pack's
 * own items, de-duplicated, and cycle-safe.
 *
 * This is the artifact's "With linked gear 3.75 kg" rollup: a rifle implies a
 * scope, rings and a bipod, and those are counted even though nobody ticked
 * them onto the pack. Excluding items already on the pack is what stops a
 * scope being counted twice once the user does add it by hand.
 */
export function collectLinkedItemIds(
  onPackItemIds: readonly ItemId[],
  links: ItemLinks,
): Set<ItemId> {
  const onPack = new Set(onPackItemIds);
  const found = new Set<ItemId>();
  const queue: ItemId[] = [...onPackItemIds];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const linked of links[current] ?? []) {
      if (onPack.has(linked) || found.has(linked)) continue;
      found.add(linked);
      // Push so the next item's own links are followed too: transitive.
      queue.push(linked);
    }
  }

  return found;
}

export interface PackWeightSummary {
  /** The bag, plus non-consumable non-worn contents. */
  baseGrams: number;
  wornGrams: number;
  consumablesGrams: number;
  /** Everything the user actually packed. Excludes linked gear. */
  contentsGrams: number;
  /** Gear implied by the pack but not explicitly on it. */
  linkedGrams: number;
  /** Contents + linked. The number that matters. */
  totalGrams: number;
  /** Lines whose item no longer exists. The UI should surface these. */
  missingItemIds: readonly ItemId[];
}

export interface CategoryWeight extends WeightClass {
  categoryId: string;
  categoryName: string;
  contentsGrams: number;
  linkedGrams: number;
  totalGrams: number;
}

/** Everything the engine needs, already indexed. Keeps the engine pure. */
export interface PackWeightInput {
  pack: Pack;
  lines: readonly PackLine[];
  itemsById: ReadonlyMap<ItemId, GearItem>;
  links: ItemLinks;
}

interface Breakdown {
  contents: Record<string, WeightClass>;
  linked: Record<string, WeightClass>;
  summary: PackWeightSummary;
  missingItemIds: ItemId[];
}

/** Single pass over the pack, shared by the summary and the category breakdown. */
function analyse({ pack, lines, itemsById, links }: PackWeightInput): Breakdown {
  const contents: Record<string, WeightClass> = {};
  const linked: Record<string, WeightClass> = {};
  const missingItemIds: ItemId[] = [];

  let contentsTotal: WeightClass = ZERO;
  const lineItemIds: ItemId[] = [];

  for (const line of lines) {
    const item = itemsById.get(line.itemId);

    if (!item) {
      missingItemIds.push(line.itemId);
      continue;
    }

    lineItemIds.push(item.id);
    const bucket: WeightClass = { baseGrams: 0, wornGrams: 0, consumablesGrams: 0 };
    bucket[classify(item)] = lineGrams(item, line);
    addTo(contents, item.categoryId, bucket);
    contentsTotal = sum(contentsTotal, bucket);
  }

  let linkedTotal: WeightClass = ZERO;

  for (const linkedId of collectLinkedItemIds(lineItemIds, links)) {
    const item = itemsById.get(linkedId);
    // A link can dangle if an item was deleted. Skipping silently would
    // understate a total, so record it alongside the missing-line ids.
    if (!item) {
      missingItemIds.push(linkedId);
      continue;
    }

    const bucket: WeightClass = { baseGrams: 0, wornGrams: 0, consumablesGrams: 0 };
    bucket[classify(item)] = resolveUnitWeight(item).grams;
    addTo(linked, item.categoryId, bucket);
    linkedTotal = sum(linkedTotal, bucket);
  }

  // The bag is carried, not worn and never consumed, so it lands in base weight.
  const bag: WeightClass = {
    baseGrams: pack.weightGrams,
    wornGrams: 0,
    consumablesGrams: 0,
  };
  addTo(contents, 'packs', bag);
  contentsTotal = sum(contentsTotal, bag);

  return {
    contents,
    linked,
    missingItemIds,
    summary: {
      baseGrams: contentsTotal.baseGrams,
      wornGrams: contentsTotal.wornGrams,
      consumablesGrams: contentsTotal.consumablesGrams,
      contentsGrams: total(contentsTotal),
      linkedGrams: total(linkedTotal),
      totalGrams: total(contentsTotal) + total(linkedTotal),
      missingItemIds,
    },
  };
}

export function summarisePack(input: PackWeightInput): PackWeightSummary {
  return analyse(input).summary;
}

/**
 * Per-category weights, for pack compare (S5-02) and the pack screen (S1-22).
 *
 * `baseGrams` / `wornGrams` / `consumablesGrams` mirror the summary exactly:
 * they are CONTENTS only. Linked gear is reported separately in `linkedGrams`
 * and folded into `totalGrams`.
 *
 * That split matters more than it looks. If the per-class figures included
 * linked gear, they would not be comparable with `summarisePack`, and a compare
 * screen could show a per-category base that did not add up to the pack total —
 * exactly the disagreement risk R7 exists to prevent.
 *
 * Two invariants hold by construction, and are asserted in the tests: the
 * categories sum to the summary totals class by class, and the pack's own
 * weight appears under `packs` so the breakdown adds up to the whole load.
 */
export function categoryBreakdown(input: PackWeightInput): CategoryWeight[] {
  const { contents, linked } = analyse(input);

  return CATEGORIES.map((category) => {
    const contentsWeights = contents[category.id] ?? ZERO;
    const linkedWeights = linked[category.id] ?? ZERO;

    return {
      categoryId: category.id,
      categoryName: category.name,
      baseGrams: contentsWeights.baseGrams,
      wornGrams: contentsWeights.wornGrams,
      consumablesGrams: contentsWeights.consumablesGrams,
      contentsGrams: total(contentsWeights),
      linkedGrams: total(linkedWeights),
      totalGrams: total(contentsWeights) + total(linkedWeights),
    };
  }).filter((row) => row.totalGrams > 0);
}

/**
 * Seed a new pack from the owner's must-have items, following linked gear
 * (the artifact's "2 must haves go into every new pack").
 *
 * Linked items are included because a must-have rifle is not a useful default
 * without its scope — that is the behaviour the original had.
 */
export function seedFromMustHaves(
  items: readonly GearItem[],
  links: ItemLinks,
): PackLine[] {
  const mustHaves = items.filter((item) => item.mustHave);
  const seeded: PackLine[] = [];
  let position = 0;

  const add = (item: GearItem) => {
    seeded.push({
      id: `seed:${item.id}`,
      packId: '' as PackId,
      itemId: item.id,
      qty: 1,
      ticked: false,
      position: position++,
    });
  };

  for (const item of mustHaves) add(item);
  for (const linkedId of collectLinkedItemIds(
    mustHaves.map((item) => item.id),
    links,
  )) {
    const item = items.find((candidate) => candidate.id === linkedId);
    if (item) add(item);
  }

  return seeded.sort((a, b) => a.position - b.position);
}
