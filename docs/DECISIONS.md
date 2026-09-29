# Architecture decisions

Append new decisions to the bottom. Never edit the substance of a superseded
decision — mark it superseded and add a new one.

Format: context → decision → consequences, kept short.

---

## D1 — React Native + Expo (TypeScript)

**Context.** The existing product is a React web artifact, and the app must ship
to both iOS and Android, solo, without a deadline.

**Decision.** Expo + React Native + TypeScript, with `expo-router` for
navigation and EAS Build for compilation.

**Consequences.**
- The Stage 1 port reuses the artifact's logic and markup structure rather than
  rewriting it, which is the single largest time saving available.
- Cloud builds mean no local Java/Android SDK is required. Xcode is still
  installed locally, so local iOS runs are possible for fast iteration.
- UI is one codebase; platform-specific work stays small.
- Trade-off accepted: less raw performance headroom than native. Acceptable for
  list-and-form screens.

## D2 — Supabase as the backend

**Context.** Solo, bootstrapped, no deadline. Needs auth, relational data, and
live updates for the compare view.

**Decision.** Supabase: Postgres, Auth, Realtime, and row-level security.

**Consequences.**
- No server code to write, host, patch or monitor. Near-zero cost at launch scale.
- Postgres gives real relational queries and transactions for the pack/weight
  model, which a document store would make awkward.
- **Row-level security is load-bearing, not defence-in-depth.** The entire
  permission model lives in Postgres policies; the app also hides UI it cannot
  use, but the database is the authority.
- Vendor coupling is real. Mitigated by keeping all queries behind a repository
  interface (D6) so the SQL surface is small and portable.

## D3 — Packs are individually maintained; trip members get read-only visibility

**Context.** The original brief said "share a pack list with other users", which
could mean collaborative editing, a read-only link, or forking. The product owner
clarified: *each person maintains their own pack and nobody else can edit it, but
everybody in a trip can see and compare each other's packs.*

**Decision.** Ownership and write access are strictly per-user. Sharing is
membership-based read access, plus a comparison view.

**Consequences.**
- Permission model collapses to one rule: *you may write rows you own, and read
  rows owned by anyone who shares a trip with you.*
- **Write conflicts become impossible.** Only one writer ever touches a given
  pack, which removes the hardest class of offline-sync bug. This is a major
  simplification of the offline design (D4).
- The tick-off checklist is per-person by construction, since a pack and its
  ticks have a single owner. There is no shared checklist in v1.
- Trade-off: no real-time co-editing. Accepted deliberately.

## D4 — Offline read, synced writes

**Context.** Backcountry hunting happens without signal. Planning at the truck
does not.

**Decision.** The local store is the read path; the network is a sync layer.
Reads are served from cache instantly. Writes are applied locally first, then
sent when connectivity allows.

**Consequences.**
- Read-your-writes is guaranteed offline, which is what a checklist needs.
- Because of D3, only the user's own rows are ever written, so replaying queued
  writes cannot conflict with anyone. Retry is safe and idempotent.
- Realtime subscriptions are used for *other members' packs* — a read-only path,
  so dropped or duplicated events are self-correcting.
- Cost: some complexity in a query/cache layer (D6) and a visible
  "pending sync" indicator in the UI.

## D5 — Personal item catalogue, fixed system categories

**Context.** Items are personal (each user builds their own inventory), but the
compare feature must break loadouts down *by category across users*.

**Decision.** Items are per-user. Categories are a **system-owned, fixed set**
seeded by the app, not user-definable in v1.

**Consequences.**
- Cross-user comparison is well-defined: two hunters' packs can be grouped and
  compared by category.
- A user cannot invent a new top-level category, which is a deliberate v1
  limitation to revisit in Stage 6.
- No moderation, abuse handling or content-seeding burden, and no liability
  arising from user-generated shared content.

## D6 — Repository pattern with a cache-first data source

**Context.** The app needs a local-only mode (Stage 1) and a synced mode
(Stage 2+), and the UI should not be rewritten between them.

**Decision.** All reads and writes go through a repository interface. The
implementation is cache-first with a background sync and a write queue. The UI
never touches Supabase directly.

**Consequences.**
- Stage 1 ships as a genuinely useful local app before any backend exists,
  which front-loads the riskiest work (the port).
- Stage 2 adds cloud sync without touching screens.
- Swapping Supabase for something else later is a contained change.
- Requires discipline: no ad-hoc queries in components.

## D7 — Placeholder app identity, renamed centrally

**Context.** Store submission needs an app name and bundle IDs, but naming is
not settled.

**Decision.** Use an obvious placeholder name and bundle IDs, defined in exactly
one config constant.

**Consequences.**
- Nothing blocks on naming.
- Renaming later is a one-line change plus store metadata updates.
- Must not be scattered: the bundle ID, app name and EAS project config all
  derive from that one constant.

## D8 — Units are stored in grams, displayed in the reader's preference

**Context.** The artifact stored kilograms and grams. Hunting communities differ
on lb/oz versus g/kg.

**Decision.** Persist all weights as integer grams. Convert only for display.
Users choose metric or imperial; default follows device locale.

**Consequences.**
- One canonical representation, no float drift, no migration when a user
  changes preference.
- Per-unit weights (`26 g ea.`) and box weights both normalise to grams cleanly.
- Rounding must be applied at the display layer only, with a rounding rule that
  is explicit per unit.

## D9 — The web artifact is reference material only, not source

**Context.** The artifact was recovered from a browser "Save Page As" archive.
The app logic was de-minified and is fully readable, but the 22 seeded items are
**not recoverable** — they exist only as prerendered HTML, never in the bundle.

**Decision.** Port behaviour and structure from `reference/pack-weigh-web/`. Do
not attempt to reuse the bundle. Treat the missing inventory data as a known
loss; the app ships with an empty catalogue and a sensible seed.

**Consequences.**
- Recovery of the original item data is abandoned. Two items in "Optics &
  accessories" were in a collapsed section and were never rendered, so they are
  permanently lost.
- The port is a reimplementation informed by a readable reference, not a
  mechanical conversion. Budget Stage 1 accordingly.
- Worth noting: the artifact used `localStorage` only for UI state, so it had no
  persistence for inventory either. The new app must be explicit about storage.

## D10 — Firearms/ammunition content is a review risk to manage, not hide

**Context.** The seeded inventory includes a rifle, scope, rings, bipod and
ammunition. Apple and Google both have policies on weapon-related content.

**Decision.** Position the app as generic outdoor pack-weight tracking. No
sales, no purchasing, no build or modification instructions, no ammunition
pricing. Keep weapon items as ordinary weight-bearing catalogue entries.

**Consequences.**
- Raises the chance of passing both stores' review.
- Marketing copy and store listings must avoid positioning this as a firearms
  app.
- **Flagged as a genuine risk** — see `docs/PLAN.md`. Validate early with a
  TestFlight/Play internal build rather than discovering it at final submission.
  This is the kind of issue that can block a release with no appeal.

## D11 — Test-driven development, with the spec written by a separate agent

**Context.** The product's value is a small set of numbers users trust
absolutely. Risk R7 in `docs/PLAN.md` is the class of bug where each screen is
individually right and collectively wrong. In commit `a2d0434`, three weight
tests failed on their first run and caught two real bugs, one of them exactly
that: per-category base figures could not be reconciled with the pack total.

**Decision.** Work test-first, through the `tdd` skill, with the specification
and the implementation written by different agents. When they disagree, **the
code changes.** A test may only be revised by the test agent, and only with a
recorded reason, because a test quietly edited to match the code is
indistinguishable from a test written to match the code.

**Consequences.**
- A single agent cannot satisfy itself. It cannot both decide what correct looks
  like and be the one judged against it, so "the test passes" stops being
  available as a shortcut to done.
- The guard is mechanical, not a promise: test files are hashed before
  implementation and re-hashed after, and the hashes must match.
- Costs a little more per task. Worth it here, where the alternative is a wrong
  total that nobody notices until a hunter is 4 kg over on a mountain.
- A failing test committed on its own is treated as a legitimate, reviewable
  statement of intent rather than a broken branch.
- The rule extends to Stage 2's RLS policies. If the same agent writes the
  policy and the test that "proves" it, the proof is worthless — and R6 is a
  security boundary, not a correctness nicety.

## D12 — expo-sqlite for the local store

**Context.** Stage 1 has to ship a genuinely local app with no backend (D4,
D6), so the local store has to be real persistence, not component state. The
backlog left `S1-02` as "SQLite or KV store". Three candidates are available in
SDK 57: `expo-sqlite`, `expo-sqlite/kv-store` (`SQLiteStorage`), and
`@react-native-async-storage/async-storage`.

**Decision.** Use **`expo-sqlite` directly, with real tables and SQL** — not
kv-store, and not AsyncStorage. The local schema mirrors `docs/DATA-MODEL.md`
minus the `user_id` columns and everything trip-related, which arrive with
Stage 2's sync.

**Rationale.**
- The data is relational. `pack_items` references both `packs` and `items`, and
  `item_links` is self-referential. Foreign keys, `ON DELETE CASCADE` and
  `UNIQUE (pack_id, item_id)` are the enforcement, not a convenience. kv-store
  is a single `storage(key, value)` table underneath, so all of that becomes
  hand-written application logic.
- S1-14 needs `WHERE category_id = ?` filtering over items, and S1-22 needs pack
  contents with a join. Under AsyncStorage or kv-store both mean loading and
  joining the entire dataset in JavaScript on every read.
- Supabase is Postgres, and the shape is a deliberate mirror of it (D2, D6).
  Real tables mean Stage 2 is a sync engine over a known schema rather than a
  translation between two incompatible models.

**Rejected alternatives.**
- **kv-store** (`SQLiteStorage`) — a stable, supported AsyncStorage replacement
  for small blobs. Wrong shape for a relational dataset. Noted because it is
  easy to reach for and it is already SQLite underneath. Its first-run migration
  race was fixed in `expo-sqlite` 57.0.2; pin at or above that.
- **AsyncStorage** — maintained and in Expo Go, but the docs describe it as
  "a good choice for storing small amounts of data… user preferences or app
  state". A few hundred to a few thousand structured rows is not that.

**Consequences.**
- `PRAGMA foreign_keys = ON` is issued **per connection**; SQLite defaults it
  off, so constraints silently do nothing until it is set. This is set in
  `onInit` and is testable.
- The async API is used, not the sync variants, which the docs warn can block
  the JS thread.
- The `expo-sqlite` config plugin stays **out of the config** until SQLCipher or
  a custom FTS build is actually wanted. The plugin only exists for native
  build-time options, and adding it needlessly forces a development build
  instead of working in Expo Go. SQLCipher specifically is not available in
  Expo Go at all.
- Web support for SQLite is alpha in SDK 57 and needs a Metro wasm config plus
  COOP/COEP headers. v1 is native-only, so that is not a dependency.
- Migrations are additive and versioned from the start. The first shipped
  schema is still a schema other installs will have to move past.

## D13 — Local schema conventions, pinned before Stage 2 ships rows

**Context.** `S1-02` built the local store. Four conventions were not pinned by
`docs/DATA-MODEL.md` and each is cheap to write down now and expensive to unpick
once Stage 2 sync has real rows on both sides.

**Decision.**
- **`LOCAL_USER_ID` is a synthesised constant.** `user_id` is absent from the
  local schema in Stage 1, since there is no account to belong to yet. Pinned by
  a test so Stage 2 sync has something concrete to reconcile against.
- **A pack's `NULL` `weight_grams` reads as `0`.** Every other nullable field
  stays `null`. The asymmetry is forced by `Pack.weightGrams` being a
  non-nullable `number` while the column is nullable, and it is load-bearing in
  exactly one place — a non-boxed consumable's `null` `pack_weight_grams` /
  `units_per_pack` pair must survive, because it is what divides 26 g per round.
- **Timestamps are ISO-8601 UTC with milliseconds**, `createdAt` immutable,
  `updatedAt` refreshed on edit. Generated locally in the same shape Postgres
  returns, so sync never has to reformat.
- **Client-generated UUIDs**, so Stage 2 pushes the same primary key rather than
  remapping ids and breaking every foreign key in flight.

**Consequences.**
- A weight of `0` and an absent weight are distinguishable everywhere except a
  pack's own weight, where they are deliberately not. If that is ever wrong, it
  is wrong in one place and is now documented.
- Stage 2 adds `user_id` as a migration. Because ids are client-generated, that
  migration is additive and does not rewrite anything.
