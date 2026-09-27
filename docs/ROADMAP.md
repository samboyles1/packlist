# Roadmap

Nine stages. Each one ends in something runnable, and each is merged before the
next starts. Task IDs live in [`BACKLOG.md`](BACKLOG.md); this document defines
what "finished" means for each stage.

The ordering is deliberate: **the riskiest work is first.** Porting the web app
and validating store-review exposure both happen before any backend work, so
neither can surprise you at the end.

---

## Stage 0 — Foundations

**Goal.** A repo that builds, lints, typechecks and runs on device, with CI and
cloud builds configured.

**Done when** a fresh clone installs, starts the dev server on iOS, and EAS
produces a build.

- Expo app scaffold, TypeScript strict, expo-router
- ESLint + Prettier, `npm run typecheck`, `npm run lint`, `npm test`
- GitHub Actions on PRs: typecheck, lint, test
- EAS project linked, internal build works
- App name/bundle ID as one central constant (D7)
- Directory structure agreed and recorded

**Why first:** every later stage depends on it. Cheap now, expensive later.

---

## Stage 1 — Local gear inventory (the port)

**Goal.** A genuinely useful local-only app, no accounts and no network. This is
the Stage 0→app risk retired, and store-review risk R1 validated.

**Done when** you can build a catalogue of items with categories and weights,
group them into packs, and see correct base/worn/consumable/total weight — with
the app running on a real device.

- Category list seeded from `docs/DATA-MODEL.md`
- Item CRUD: brand, name, category, weight, consumable/box, worn, litre volume
- Pack CRUD with ordered lines and quantity
- **The weight engine** as a pure module, unit-tested against hand-computed
  cases (mitigates R7)
- Unit toggle metric/imperial, storage always grams (D8)
- Tick-off checklist on pack lines
- "Must have" seeding into new packs
- Item links ("with linked gear") with transitive rollup
- **Real device build on TestFlight and/or Play internal** — validate R1 now
- No network calls at all

**Watch:** R3, the port is a reimplementation not a conversion (D9). If the port
drags, cut presentation fidelity and keep the data model — the form UI is the
part that matters.

---

## Stage 2 — Accounts and cloud sync

**Goal.** Sign-up/sign-in, and the same data syncing across devices.

**Done when** you can sign in on two devices and your own catalogue and packs
appear on both, with edits propagating and no writes possible to another user's
rows.

- Supabase project + migrations applied (`docs/DATA-MODEL.md`)
- Auth: email magic link and/or OAuth; session in SecureStore
- `profiles` row on first sign-in, units preference
- Repository swapped to cache-first with sync engine (D6) — **no screen changes**
- Offline persistence of the local store
- Write queue with retry, idempotent (mitigates R2)
- Sync status indicator
- **RLS policy tests**: co-member readable, non-member not readable, write
  denied on others' rows (mitigates R6)

**Note:** screens written in Stage 1 should not change. If they do, D6 was not
respected.

---

## Stage 3 — Trips and membership

**Goal.** Create a trip and put people on it.

**Done when** you can create a trip, invite by email, and see a members list.

- Trip CRUD: name, dates, location, notes
- Invite link generation, expiring, token hashed
- Invite acceptance
- Roles: owner / organiser / member
- Member removal by owner
- Offline access to trips you are a member of

---

## Stage 4 — Read-only visibility of co-members' packs

**Goal.** See other people's packs inside a trip.

**Done when** you can open a trip and view every member's packs and their
contents, with no way to edit them.

- Trip → members → each member's packs
- Read-only pack detail view, clearly distinguished from your own
- Link an existing pack to a trip
- Confirm RLS is the only thing enforcing this (attempt a write in a test)
- Empty states: member with no packs, trip with one member

---

## Stage 5 — Pack compare

**Goal.** The reason the app exists.

**Done when** you can select two or more members' packs and see a per-category
weight breakdown and a total weight comparison.

- Multi-pack selection
- Per-category breakdown using the system taxonomy (D5)
- Weight comparison: base / worn / consumables / total
- Consumable handling, including ammo boxes
- Visual: grouped bars per category plus totals
- Per-unit and linked-gear rollups shown consistently
- Realtime updates as members edit (D4) with refetch-on-focus fallback
- **Snapshot/export** for pre-trip reference
- Mitigates R4

**Watch:** the numbers must match the pack screens exactly. Test against R7 cases.

---

## Stage 6 — Templates, sharing polish, and item management

**Goal.** Reduce friction in building packs, and close known v1 gaps.

**Done when** a pack can be built from a template and edits are comfortable on a
phone.

- Reusable list templates from an existing pack
- "Must have" set management; seed new packs from it
- Item duplication, multi-select, bulk category assignment
- Reorder lines by drag
- Search and filter a large catalogue
- User-defined categories — **evaluate D5 again** now that compare is proven
- Units per category defaults

---

## Stage 7 — Onboarding and account management

**Goal.** Someone who has never seen the app can use it, and can manage their
account without support.

**Done when** a new user goes from install to a working pack unaided, and can
export or delete their data.

- First-run onboarding, optional
- Account screen: display name, units, sign out
- Data export (their own data, machine-readable)
- Account and data deletion — **required by both stores**
- Support and privacy links
- Error and empty states throughout
- Accessibility pass: labels, contrast, dynamic type, screen reader on core flows

---

## Stage 8 — Store submission

**Goal.** Live on the App Store and Google Play.

**Done when** both are approved and the listing is public.

- Store metadata, assets, screenshots (from real screens)
- Privacy policy and support page live
- Privacy/nutrition labels completed to match actual behaviour
- Age rating answered, R1 position documented
- Build signed, versioned, and rolled out via EAS
- Phased rollout / staged testing where available
- Review response prepared for likely questions
- Post-submission monitoring plan

**Watch:** R1 surfaces here if it was not validated in Stage 1.

---

## Stage 9 — Post-launch

**Goal.** Operate it and find out what people actually need.

- Crash and error reporting (Sentry or similar, free tier)
- Opt-in, privacy-respecting analytics
- Read reviews, triage into the backlog
- First real feature requests from users
- Decide on subscriptions if store economics demand it — keep free forever for
  the core loop
