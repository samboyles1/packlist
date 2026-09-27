import type { Category, CategoryId } from '@/types/gear';

/**
 * The system-owned category taxonomy (D5).
 *
 * Confirmed by the owner as non-negotiable: pack compare breaks loadouts down by
 * category across users, which is only meaningful if the set is fixed and shared.
 *
 * Seeded into Supabase in Stage 2 (S2-05) and used for the local seed in Stage 1.
 * Ids are stable and must never be renamed once users have data.
 *
 * `packs` and `accessory` sort first and last deliberately: they are the two
 * categories that describe the carrier and the catch-all, not categories of gear
 * a hunter thinks in when packing.
 */
export const CATEGORIES: readonly Category[] = [
  { id: 'packs', name: 'Packs', sortOrder: 0 },
  { id: 'clothing', name: 'Clothing', sortOrder: 1 },
  { id: 'firearms', name: 'Firearms & accessories', sortOrder: 2 },
  { id: 'optics', name: 'Optics & accessories', sortOrder: 3 },
  { id: 'food', name: 'Food', sortOrder: 4 },
  { id: 'cooking', name: 'Cooking', sortOrder: 5 },
  { id: 'sleeping', name: 'Sleeping', sortOrder: 6 },
  { id: 'footwear', name: 'Footwear', sortOrder: 7 },
  { id: 'pouches', name: 'Pouches & organisers', sortOrder: 8 },
  { id: 'accessory', name: 'Accessory', sortOrder: 9 },
] as const;

const BY_ID: ReadonlyMap<CategoryId, Category> = new Map(
  CATEGORIES.map((category) => [category.id, category]),
);

/** Stable ordering for display: by sortOrder, then name. */
export const SORTED_CATEGORIES: readonly Category[] = [...CATEGORIES].sort(
  (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
);

export function getCategory(id: CategoryId): Category | undefined {
  return BY_ID.get(id);
}

export function categoryName(id: CategoryId): string {
  // Falling back to the raw id keeps the UI honest: an unknown category should
  // be visible as a problem, not silently swallowed into a shared bucket.
  return BY_ID.get(id)?.name ?? id;
}
