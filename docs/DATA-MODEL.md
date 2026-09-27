# Data model

Postgres schema, row-level security, and the weight engine. This document is
the contract between the app and Supabase; `docs/DECISIONS.md` records why it is
shaped this way.

All weights are **integer grams** (D8). All timestamps are `timestamptz`.

---

## Reference data

```sql
-- System-owned, fixed taxonomy. Not user-editable in v1 (D5).
create table categories (
  id          text primary key,
  name        text not null,
  sort_order  int  not null
);
```

Seeded from the original artifact:

`packs`, `clothing`, `firearms`, `optics`, `food`, `cooking`, `sleeping`,
`footwear`, `pouches`, `accessory`.

## Users

```sql
create table profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null,
  units        text not null default 'metric' check (units in ('metric','imperial')),
  created_at   timestamptz not null default now()
);
```

`units` is a display preference only; storage is always grams.

## Items — personal catalogue

```sql
create table items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles on delete cascade,
  category_id       text not null references categories,

  brand             text,
  name              text not null,

  -- weight of a single unit, in grams
  weight_grams      int  not null default 0 check (weight_grams >= 0),
  -- true for things bought by weight/count: ammo, bars, meals
  is_consumable     boolean not null default false,
  -- for consumables: weight of the whole box, and how many units it holds
  pack_weight_grams int check (pack_weight_grams is null or pack_weight_grams >= 0),
  units_per_pack    int check (units_per_pack    is null or units_per_pack    >  0),

  -- worn weight is tracked separately from base weight (industry convention)
  is_worn           boolean not null default false,

  -- litre volume, for packs and volume-relevant gear
  litre_volume      numeric(6,2) check (litre_volume is null or litre_volume >= 0),

  -- "goes into every new pack" — seeds new packs (see D3 / artifact behaviour)
  must_have         boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index items_user_cat_idx on items (user_id, category_id);

-- the artifact's "linked gear": implying an item implies these too
create table item_links (
  item_id         uuid not null references items on delete cascade,
  linked_item_id  uuid not null references items on delete cascade,
  primary key (item_id, linked_item_id),
  check (item_id <> linked_item_id)
);
```

## Packs — owned, individually maintained

```sql
create table packs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles on delete cascade,
  name          text not null,
  -- e.g. 'Hunting Pack', 'Day Pack'
  type          text,
  litre_volume  numeric(6,2) check (litre_volume is null or litre_volume >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index packs_user_idx on packs (user_id);

create table pack_items (
  id        uuid primary key default gen_random_uuid(),
  pack_id   uuid not null references packs on delete cascade,
  item_id   uuid not null references items on delete cascade,
  qty       int  not null default 1 check (qty > 0),
  -- the tick-off checklist; per-owner, so no cross-user state (D3)
  ticked    boolean not null default false,
  position  int  not null default 0,
  unique (pack_id, item_id)
);

create index pack_items_pack_idx on pack_items (pack_id, position);
```

A pack's own weight/litre volume lives on `packs`; its contents on `pack_items`.

## Trips and membership — the sharing boundary

```sql
create table trips (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles on delete cascade,
  name       text not null,
  start_date date,
  end_date   date,
  location   text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (end_date is null or start_date is null or end_date >= start_date)
);

create table trip_members (
  trip_id uuid not null references trips  on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  -- owner can remove members and delete the trip; member can read and compare
  role    text not null default 'member' check (role in ('owner','organiser','member')),
  primary key (trip_id, user_id)
);

create index trip_members_user_idx on trip_members (user_id);
```

Membership is established by a pending invite row:

```sql
create table trip_invites (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('organiser','member')),
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id, email)
);
```

Invites are a private link. Membership is the only thing that grants read
access — **there is no "anyone with the link can read" path** (D3), so a leaked
invite link is a low-severity, expiring risk rather than a data breach.

## Row-level security

This is the authorisation model. It is the whole model (D2, D3).

```sql
-- Does `me` and `other` share at least one trip?
create function shares_trip_with(me uuid, other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from trip_members a
    join trip_members b on b.trip_id = a.trip_id
    where a.user_id = me and b.user_id = other
  );
$$;
```

Ownership-aware tables (`items`, `packs`, `pack_items`, `item_links`):

```sql
alter table items      enable row level security;
alter table packs      enable row level security;
alter table pack_items enable row level security;
alter table item_links enable row level security;

-- readable if you own it, or a co-member can see it
create policy read_visible on items for select using (
  user_id = auth.uid() or exists (
    select 1 from packs p
    where p.user_id = items.user_id
      and shares_trip_with(auth.uid(), p.user_id)
  )
);

-- writable only by the owner. This is D3 expressed as a constraint.
create policy write_own on items for all using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);
```

`packs` gets the same pair, with `packs.user_id`.

`pack_items` and `item_links` have no `user_id` of their own, so they reach
visibility through their parent:

```sql
create policy read_visible on pack_items for select using (
  exists (select 1 from packs p
          where p.id = pack_items.pack_id
            and shares_trip_with(auth.uid(), p.user_id))
);

create policy write_own on pack_items for all using (
  exists (select 1 from packs p
          where p.id = pack_items.pack_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from packs p
          where p.id = pack_items.pack_id and p.user_id = auth.uid())
);
```

`item_links` follows `item_links.item_id → items.user_id`; only the owner of the
*implying* item may change links.

Trips and membership:

```sql
alter table trips        enable row level security;
alter table trip_members enable row level security;

create policy read_member on trips for select using (
  shares_trip_with(auth.uid(), owner_id)
);

create policy write_owner on trips for all using (
  owner_id = auth.uid()
) with check (owner_id = auth.uid());

create policy read_members on trip_members for select using (
  exists (select 1 from trip_members m
          where m.trip_id = trip_members.trip_id and m.user_id = auth.uid())
);
```

Policies on `trip_members` are recursive, so they are written with a
`security definer` helper rather than a self-referencing subquery. `write_members`
is restricted to the trip owner.

## Realtime

The compare view needs other members' packs to update live (D4, D5).

```sql
alter publication supabase_realtime add table packs;
alter publication supabase_realtime add table pack_items;
```

Only these two are added. Subscriptions are a **read path**; if an event is
dropped, the next refetch corrects it, and because no user writes another
user's rows (D3) there is no conflict to resolve.

## The weight engine

Derived, never stored. Single source of truth in
`src/lib/weights.ts`, shared by the pack screen, the compare screen, and any
export.

Per pack:

| Figure | Definition |
|---|---|
| Base weight | Σ non-consumable, non-worn `weight_grams × qty` |
| Worn weight | Σ `is_worn` items |
| Consumables | Σ consumable `weight_grams × qty` |
| **Total** | base + worn + consumables |
| Linked gear | Σ weights of `item_links` targets, transitively, de-duplicated |
| Contents weight | base + worn + consumables + linked |

Consumable handling, given `units_per_pack` and `pack_weight_grams`:

- Both set → per-unit weight is `pack_weight_grams / units_per_pack`; qty is
  counted in **units**, so 20 rounds = qty 20.
- `weight_grams` only → qty counted in units directly.
- `pack_weight_grams` only → qty counted in boxes; the box contributes
  `pack_weight_grams` each.

The artifact displayed `26 g ea.` and a `With linked gear 3.75 kg` rollup, so both
cases must render. Division is done once and rounded half-up to the nearest
integer gram so the total always equals the sum of displayed line weights.

Per-category weight (the compare breakdown) is the same three figures grouped by
`items.category_id`, using the system taxonomy so two users' packs can be
compared directly.

## Local mirror

The offline cache (D4) mirrors the same shape as a set of tables keyed by primary
key, plus:

- `pending_mutations` — queued writes with an idempotency key
- `last_synced_at` — surfaced in the UI as the sync indicator

Migrations are applied by hand from `supabase/migrations/` until the project has a
CI-managed reset, then automated.
