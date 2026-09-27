# Backlog

The task list. **This is the source of truth for what happens next.**

- IDs are stable and never reused. Commit messages reference them: `S3-02: ...`
- New requirements get the next free ID, appended under the right stage, with a
  line explaining *why* it was added
- Tick a box when it is committed and working, not when it is started
- A stage is done when all its tasks are ticked and its "done when" in
  [`ROADMAP.md`](ROADMAP.md) is true

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (say why)

---

## Stage 0 — Foundations

- [x] `S0-01` Create Expo app scaffold, TypeScript strict, expo-router
- [x] `S0-02` Central app identity constant: name, bundle ID, store fields (D7)
- [x] `S0-03` ESLint + Prettier, `npm run lint`, `npm run typecheck`
- [x] `S0-04` Test runner wired (`npm test`) — 5 tests guarding the app config
- [x] `S0-05` GitHub Actions: typecheck + lint + test on PRs
- [x] `S0-06` EAS project created and linked — `@supasma/packlist`. `eas
      project:info` resolves. **Build verification deferred to `S1-29`**, where
      there is actually something to build; `expo export` already proves the
      bundle and native config are sound for both platforms.
- [x] `S0-07` Directory structure agreed and documented in README
- [x] `S0-08` Configure the GitHub remote and push — github.com/samboyles1/packlist
- [x] `S0-09` `.env.example` for Supabase URL and anon key
- [x] `S0-10` Tooling gaps decided and documented: Android builds are cloud-only
      (no local JDK, and none needed). iOS runs locally against Xcode 26.

## Stage 1 — Local gear inventory (the port)

### Data model
- [x] `S1-01` Category list seeded from `docs/DATA-MODEL.md`
      — *confirmed by owner: categories are system-owned, not user-definable*
- [ ] `S1-02` Local store for items, packs, pack lines (SQLite or KV store)
- [x] `S1-03` Item type definitions mirroring the Supabase schema

### Weight engine
- [x] `S1-04` `src/lib/weights.ts` — base / worn / consumables / total. Linked-gear
      rollup verified against the artifact's 3748 g -> 3.75 kg
- [x] `S1-05` Consumable handling: per-unit vs box, `units_per_pack` (R7)
- [x] `S1-06` Linked-gear rollup, transitive and de-duplicated
- [x] `S1-07` Per-category weight breakdown
- [x] `S1-08` Unit tests against hand-computed cases from the artifact (R7)
- [x] `S1-09` Rounding rule: half-up at display only, totals equal sum of lines

### Item management
- [ ] `S1-10` Item list grouped by category, collapsible sections
- [ ] `S1-11` Item create/edit form: brand, name, category, weight
- [ ] `S1-12` Consumable editor: box weight + units per box
- [ ] `S1-13` Worn-weight and litre-volume fields
- [ ] `S1-14` Search and filter
- [ ] `S1-15` Item delete with confirmation

### Packs
- [ ] `S1-16` Pack list screen
- [ ] `S1-17` Pack create/edit: name, type, own weight, litre volume
- [ ] `S1-18` Pack detail: lines grouped by category
- [ ] `S1-19` Add/remove lines from the catalogue, quantity edit
- [ ] `S1-20` Line reordering
- [ ] `S1-21` Tick-off checklist per line, persisted
- [ ] `S1-22` Pack totals display: base / worn / consumables / total
- [ ] `S1-23` "With linked gear" rollup display

### Must-have seeding
- [ ] `S1-24` `must_have` toggle on items
- [ ] `S1-25` Seed new packs from must-have items
- [ ] `S1-26` Item link editor, mirroring the artifact's linked gear

### Units
- [ ] `S1-27` Unit preference (metric/imperial), default from device locale
- [ ] `S1-28` Display formatting: kg/g and lb/oz (D8)

### Validation — do not skip
- [ ] `S1-29` **Build on a real device and check App Store / Play policy
      exposure for firearms content** (R1, D10). This is the reason Stage 1 is
      early. Record the finding in `docs/DECISIONS.md`.
- [ ] `S1-30` Confirm zero network calls in the local build

## Stage 2 — Accounts and cloud sync

### Backend
- [ ] `S2-01` Supabase project created (owner action)
- [ ] `S2-02` Migrations for `categories`, `profiles`, `items`, `item_links`,
      `packs`, `pack_items` (D10 of the schema section in DATA-MODEL.md)
- [ ] `S2-03` `shares_trip_with` helper function
- [ ] `S2-04` RLS policies for owner-write / co-member-read
- [ ] `S2-05` Seed script for categories
- [ ] `S2-06` Supabase types generated into the app

### Auth
- [ ] `S2-07` Supabase client, session persisted to SecureStore
- [ ] `S2-08` Sign in — email magic link
- [ ] `S2-09` Sign in — Apple and/or Google OAuth
- [ ] `S2-10` `profiles` row created on first sign-in
- [ ] `S2-11` Sign out, session expiry handling

### Sync
- [ ] `S2-12` Repository interface defined (D6)
- [ ] `S2-13` Cache-first read path
- [ ] `S2-14` Write queue with retry and idempotency keys (R2)
- [ ] `S2-15` Pull-on-focus and pull-on-reconnect
- [ ] `S2-16` Sync status indicator in the UI
- [ ] `S2-17` Conflict-free-write argument tested: only own rows are written (D3)
- [ ] `S2-18` `migrateLocalToCloud` — adopt local-only Stage 1 data on first
      sign-in. *Lower priority than it looks: no user gets the app before
      accounts exist, so the only data to migrate is the developer's own.*
      Still worth doing so Stage 1 testing data survives Stage 2.

### Tests
- [ ] `S2-19` RLS policy tests: co-member read allowed, stranger read denied,
      write to another's row denied (R6)
- [ ] `S2-20` Run policy tests in CI against a throwaway project

## Stage 3 — Trips and membership

- [ ] `S3-01` Trip list and create/edit (name, dates, location, notes)
- [ ] `S3-02` `trips` / `trip_members` migrations + RLS
- [ ] `S3-03` Invite link generation, expiring, token hashed
- [ ] `S3-04` Invite acceptance flow
- [ ] `S3-05` Members list with roles
- [ ] `S3-06` Owner can remove members
- [ ] `S3-07` Offline access to your trips
- [ ] `S3-08` Inviting someone who has no account yet — onboarding path

## Stage 4 — Read-only co-member packs

- [ ] `S4-01` Trip detail: members and their packs
- [ ] `S4-02` Read-only pack view, visually distinct from your own
- [ ] `S4-03` Attach an existing pack to a trip
- [ ] `S4-04` Verify a write attempt on a co-member's pack is rejected by RLS
- [ ] `S4-05` Empty states: member with no packs; trip with one member
- [ ] `S4-06` Handle a member who has shared no packs

## Stage 5 — Pack compare

- [ ] `S5-01` Multi-pack selection UI
- [ ] `S5-02` Per-category weight breakdown using system categories (D5)
- [ ] `S5-03` Weight comparison: base / worn / consumables / total
- [ ] `S5-04` Consumable and ammo-box handling in comparison
- [ ] `S5-05` Grouped bar visualisation per category
- [ ] `S5-06` Totals comparison summary
- [ ] `S5-07` Linked-gear rollup consistent with pack screens
- [ ] `S5-08` Realtime subscription for co-member packs (read path only)
- [ ] `S5-09` Refetch on focus as the correctness fallback (R4)
- [ ] `S5-10` Debounce realtime events
- [ ] `S5-11` Snapshot / shareable export of a comparison
- [ ] `S5-12` Tests asserting compare numbers match pack screens exactly (R7)

## Stage 6 — Templates and item management

- [ ] `S6-01` Save a pack as a reusable template
- [ ] `S6-02` Create a pack from a template
- [ ] `S6-03` "Must have" set management screen
- [ ] `S6-04` Item duplication
- [ ] `S6-05` Multi-select items, bulk category assignment
- [ ] `S6-06` Drag to reorder lines
- [ ] `S6-07` Large-catalogue search performance
- [ ] `S6-08` Re-evaluate user-defined categories (D5) now compare is proven
- [ ] `S6-09` Default category per unit type

## Stage 7 — Onboarding and account

- [ ] `S7-01` First-run onboarding
- [ ] `S7-02` Account screen: display name, units, sign out
- [ ] `S7-03` Export own data, machine-readable (App Store requires)
- [ ] `S7-04` Delete account and all data (both stores require)
- [ ] `S7-05` Support and privacy links in app
- [ ] `S7-06` Error, empty and loading states throughout
- [ ] `S7-07` Accessibility: labels, contrast, dynamic type
- [ ] `S7-08` Screen reader pass on core flows

## Stage 8 — Store submission

- [ ] `S8-01` Apple Developer Program enrolled (owner action)
- [ ] `S8-02` Google Play Console enrolled (owner action)
- [ ] `S8-03` Support page and privacy policy live (owner action)
      — *confirmed by owner: deliberately deferred until close to release, not
      a blocker for any build work*
- [ ] `S8-04` App icon and store screenshots from real screens
- [ ] `S8-05` Store description and keywords, avoiding firearms positioning (D10)
- [ ] `S8-06` Privacy labels / data safety form matches actual behaviour
- [ ] `S8-07` Age rating questionnaire answered honestly
- [ ] `S8-08` Signed release builds via EAS
- [ ] `S8-09` Phased rollout configured
- [ ] `S8-10` Review response prepared, with the R1 position documented
- [ ] `S8-11` Post-submission monitoring plan

## Stage 9 — Post-launch

- [ ] `S9-01` Crash and error reporting
- [ ] `S9-02` Opt-in, privacy-respecting analytics
- [ ] `S9-03` Review-triage process into this backlog
- [ ] `S9-04` Evaluate subscriptions, keeping the core loop free
- [ ] `S9-05` First user-driven feature requests

---

## Ideas not yet scheduled

Promoted to tasks when there is room. Each needs a decision if it affects the
data model.

- Barrel/inventory of ammunition as a *stock* system, separate from gear weight
- Export a pack list to PDF for printing
- Weight history over time — did my base weight actually go down?
- Public/anon read-only links — **conflicts with D3, needs a decision**
- Share an item catalogue with another user — conflicts with D5, needs a decision
- Custom category icons
- Multiple profiles on one device
- Import from a spreadsheet of existing gear
- Attach a photo to an item
- Weather and trip-itinerary features
- Wearables / lock screen widget for pack weight
- Multi-trip view: what gear am I duplicating across trips
- Print-friendly list for the truck
