/**
 * Domain types, mirroring docs/DATA-MODEL.md.
 *
 * These are the app's own shapes, not Supabase rows. The repository layer (D6)
 * maps between the two, which is what lets the local store in Stage 1 and the
 * Postgres tables in Stage 2 diverge without touching screens.
 *
 * All weights are integer grams (D8). Never store kilograms here.
 */

export type ItemId = string;
export type PackId = string;
export type LineId = string;
export type CategoryId = string;

/** Display preference only. Storage is always grams. */
export type UnitSystem = 'metric' | 'imperial';

/**
 * System-owned taxonomy (D5, confirmed by the owner). Not user-definable in v1 —
 * pack compare is only meaningful if everyone buckets their gear the same way.
 */
export interface Category {
  readonly id: CategoryId;
  readonly name: string;
  readonly sortOrder: number;
}

export interface GearItem {
  id: ItemId;
  userId: string;
  categoryId: CategoryId;

  brand: string | null;
  name: string;

  /** Weight of a single unit, in grams. For non-consumables, the item's weight. */
  weightGrams: number;

  /**
   * Consumables are counted and weighed differently from gear: by the piece.
   * Ammunition and food are bought by the box but consumed by the unit.
   */
  isConsumable: boolean;
  /** Weight of the whole box, when the item is bought in one. */
  packWeightGrams: number | null;
  /** How many units a box holds, e.g. 20 rounds. */
  unitsPerPack: number | null;

  /** Worn weight is tracked separately from base weight. */
  isWorn: boolean;

  /** Litre volume, for packs and anything measured by footprint. */
  litreVolume: number | null;

  /** "Goes into every new pack" — seeds new packs. */
  mustHave: boolean;

  createdAt: string;
  updatedAt: string;
}

/** The bag itself. Contents live in `PackLine`. */
export interface Pack {
  id: PackId;
  userId: string;
  name: string;
  /** e.g. 'Hunting Pack', 'Day Pack' */
  type: string | null;
  /** The bag's own weight, carried before any contents. Part of base weight. */
  weightGrams: number;
  litreVolume: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PackLine {
  id: LineId;
  packId: PackId;
  itemId: ItemId;
  /** Units, or boxes when the item is a consumable measured by box. */
  qty: number;
  /** The tick-off checklist. Per-owner, so there is no shared state (D3). */
  ticked: boolean;
  position: number;
}

/** "A implies B", e.g. a rifle implies its scope, rings and bipod. */
export type ItemLinks = Readonly<Record<ItemId, readonly ItemId[]>>;
