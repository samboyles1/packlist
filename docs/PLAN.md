# Master plan

## Product

A shared pack-weight planner for hunting trips.

Each hunter maintains **their own** pack — their gear, their weights, their
ticks. When they join a trip, they can see every other member's pack and
**compare loadouts side by side**, broken down by category, with weight
comparison. Nobody can edit anybody else's pack.

The value is a group question that spreadsheets answer badly: *are we actually
carrying too much, and where?*

### Why this shape

The original brief said "share a pack list". The reframe that emerged — per-user
packs with read-only visibility and a comparison view — is a better product and a
simpler system:

- Each person keeps editorial control of their own kit, so nobody has to ask
  permission to change their own weights.
- Comparison is the actual insight, and it is cheap once membership exists.
- Because only the owner writes their own pack, **offline sync has no conflict
  surface at all** (D3). That is the single largest simplification in the plan.

### v1 scope

In:
- Gear inventory: categories, items, quantities, weights, per-unit and box
  weights, worn vs base, litre volume
- Packs: named, typed, own weight/volume, ordered lines, tick-off checklist
- Reusable list templates ("must have" items seeded into new packs)
- Trips with members
- Read-only visibility of co-members' packs
- Pack compare: per-category breakdown + weight comparison
- Offline read, synced writes
- Metric/imperial display

Out for v1 (deliberate, recorded so it is not re-litigated):
- Live co-editing of a shared list — explicitly rejected (D3)
- Public/shareable links with anonymous read — rejected in favour of
  membership-gated read (D3, safer default)
- User-defined categories — system set only (D5)
- Community/shared item catalogue — personal only (D5)
- A separate trip-level shared checklist — a pack and its ticks have one owner
- Ammunition purchasing, pricing, build instructions — see D10
- Native app polish (widgets, watch app, widgets, deep links) — post-launch

### Distribution constraint

**No user gets this app before accounts are working** (Stage 2). Confirmed by
the owner. Consequences:

- Stage 1 ships local-only and is for the developer's own use and testing, so
  the local-to-cloud migration (`S2-18`) is a convenience rather than a
  user-facing data-loss risk.
- There is no window where a user has data trapped in a device-local store,
  which is the usual reason to build migration carefully.
- TestFlight/Play internal distribution in Stage 1 is for policy validation
  (`S1-29`), not for gathering user feedback.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Expo app (TypeScript)                      │
│                                              │
│  expo-router screens                        │
│      ↓ only ever calls ↓                     │
│  repository interface            (D6)        │
│      ↓                                       │
│  cache-first data source                     │
│    ├─ local store  (read path, offline)      │
│    └─ sync engine  (write queue + push)      │
│         ↓                        ↓           │
│  Supabase client          Realtime subs      │
└─────────┼────────────────────────┼───────────┘
          ↓                        ↓
   ┌──────────────────────────────────────┐
   │  Supabase                            │
   │   Postgres ── RLS is the authz model │
   │   Auth                                │
   │   Realtime (reads only)              │
   └──────────────────────────────────────┘
```

Layer rules, so this stays true as the app grows:

1. **No component queries Supabase directly.** Screens call the repository.
2. **RLS is the authority.** The app hides what it cannot use, but a bug in the
   app must never be able to leak another user's pack.
3. **The weight engine is pure and has one home** (`src/lib/weights.ts`), so the
   pack screen and the compare screen can never disagree.
4. **Derived numbers are never stored.** Totals are computed.

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | ~~Weapons content trips store review.~~ **RESOLVED** — the owner confirmed with both stores that the use case is acceptable, on the basis that all gear data is user-entered. | — | Closed. `docs/DECISIONS.md` D10 still holds: no sales, no build instructions, no ammo pricing. Keep that discipline so the answer stays true. |
| R2 | Offline sync is the most bug-prone part. | Data feels broken; trust collapse. | Queue writes only for own rows (D3) so replay is idempotent. Add a visible sync indicator. Ship offline read before offline writes. Required to be built test-first through the `tdd` skill (D11) — this is the area most likely to hide a bug behind a plausible-looking test. |
| R3 | Stage 1 port is underestimated. | Timeline slips at the start. | The reference bundle is readable, but it is a reimplementation, not a conversion (D9). Timebox it; fall back to a plain CRUD form UI if the port drags. |
| R4 | Realtime compare view feels stale or spams. | Perceived bug. | Realtime is an optimisation only — always also refetch on focus. Debounce. |
| R5 | Solo maintenance burden. | Rot. | Free tiers, no servers to patch. Supabase + Expo chosen partly to avoid an ops surface (D2). |
| R6 | RLS policies have recursive or wrong subqueries. | Either an error or a leak. | Policy tests in CI that assert as user A that user B's pack is readable via a shared trip and **not** readable otherwise. |
| R7 | Rounding disagrees between screens. | Distrust of the numbers. | One weight module, tested against hand-computed cases (D8). |

## Only the repo owner can do these

These need real accounts, identity verification, or payment. They are not
code tasks and cannot be automated.

- [ ] **Apple Developer Program** — $99/yr. Needs a real Apple ID, legal entity or
      individual name matching the store listing. Gate for TestFlight *and* the
      App Store. **Start early**; identity verification and enrolment are not
      instant and it gates the Stage 1 device check (`S1-29`).
- [ ] **Google Play Console** — one-off ~$25. Needs identity verification.
      Same advice: enrolment is not instant, and it gates the Stage 1 device
      check.
- [ ] **Supabase project** — create the project, keep the DB password safe.
- [ ] **Expo account + EAS project** — link the GitHub repo.
- [ ] **Domain / support URL** — stores require a real support page and a
      reachable contact email.
- [ ] **Privacy policy** — required by both stores. Must describe the actual
      data collected (email, display name, gear lists). *Deliberately deferred
      to just before release — it is not a blocker for build work.*
- [ ] **Store assets** — icon, screenshots, description, marketing copy that
      avoids firearms positioning (D10).
- [ ] **Age rating questionnaire** — answer honestly, including any weapons
      category, and expect scrutiny.
- [ ] **Final review responses** — be ready to explain the gear catalogue.

## How to work on this across sessions

**Work test-first.** Load the `tdd` skill before touching implementation code. A
separate agent writes the tests, a separate agent writes the code, and the code
is fixed when the two disagree (D11). The backlog task ID goes in the commit
message.

1. Open `docs/BACKLOG.md`, pick the lowest-numbered unstarted task for the
   current stage.
2. Follow the `tdd` skill: hash the test files, have the test agent write the
   failing tests, commit them red, have the implement agent make them pass,
   then re-hash to prove no test was edited.
3. Commit in small chunks — one logical change per commit, with
   the task ID in the message (`S3-02: ...`).
4. New requirement? Add a task with the next free ID. Do not expand a stage
   silently.
5. A decision that would be expensive to reverse? Add it to `docs/DECISIONS.md`
   first, then implement it.

**The backlog is the source of truth for what is next.** If this document and
the backlog disagree, the backlog is what was actually committed.

## CI is the gate

Every PR runs typecheck, lint, tests, a format check, an Expo config load and a
real Metro export. `main` is branch-protected: **a PR cannot merge unless all of
it passes**, and `main` cannot be pushed to directly.

This matters beyond process. RLS is the authorisation model, not
defence-in-depth — a bug in the app must never be able to leak another user's
pack. A merge gate is what keeps that guarantee from decaying as the app grows.
