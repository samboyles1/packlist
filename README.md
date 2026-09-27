# Packlist

A shared pack-weight planner for hunting trips. Every hunter maintains their own
pack; trip members can see and compare each other's loadouts by category and
total weight.

Currently at **Stage 0 — planning**. No application code exists yet. The product
is being built in stages; see [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Status

| | |
|---|---|
| Stack | Expo SDK 57 (React Native 0.86), TypeScript, expo-router, Supabase |
| Stage | 1 — Local gear inventory |
| Expo SDK | 57 · React 19.2.3 · Node 22 |
| Repo | github.com/samboyles1/packlist (public) |
| App name | Placeholder — `app.config.ts` is the only place to rename |
| Merge gate | `main` is protected: PR only, and `Typecheck, lint and test` must pass |

## Commands

```bash
npm start          # dev server
npm run ios        # dev server, iOS  (Xcode 26 installed locally)
npm run android    # requires a dev build; see "Builds" below
npm run typecheck  # tsc --noEmit
npm run lint       # expo lint
npm test           # jest
npm run doctor     # expo-doctor, dependency and config diagnosis
```

## Directory structure

```
app.config.ts              Expo config + THE app identity (decision D7).
                           Self-contained by necessity — do not import from src/.
metro.config.js            BlockLists reference/ so the watcher skips it.
src/
  app/                     expo-router routes. Files here are screens; a
                           _layout.tsx defines a navigator. No business logic.
  components/              Presentational, reusable. No data access.
  lib/                     Pure logic. The weight engine lives here (S1-04) and
                           is the only place totals are computed.
  data/                    Repository interface and data sources (D6). No
                           component may import Supabase directly.
  types/                   Shared types.
  __tests__/               Unit tests.
docs/                      The plan. See the table above.
reference/                 The original web artifact, de-minified. Not built
                           into the app; blockListed from Metro.
supabase/migrations/       Applied by hand from Stage 2 (S2-02).
assets/                    Icons. Store assets come later, at Stage 8.
```

The layering rule that matters: **`src/app/` may only talk to `src/data/`, and
only via the repository interface.** Screens never query Supabase and never
compute a weight.

## Builds

Android builds are **cloud-only** — no local JDK is installed, and none is
needed. iOS can run locally against the installed Xcode; both platforms build
through EAS.

## Documents

| Doc | Purpose |
|---|---|
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architecture decisions and why. New decisions get appended here. |
| [`docs/PLAN.md`](docs/PLAN.md) | Product scope, architecture, risks, things only the owner can do. |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Supabase schema, row-level security policies, weight engine. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Stages 0–9, what "done" means for each. |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | The iterated task checklist. Stable task IDs. |

## Working agreement

- **Test-driven.** Load the `tdd` skill before touching implementation code. A
  separate agent writes the tests, a separate agent writes the code, and the code
  is fixed when the two disagree. Tests are the specification. See
  [`docs/DECISIONS.md`](docs/DECISIONS.md) D11.
- **Work in stages.** Finish and merge a stage before starting the next.
- **Commit in small, reviewable chunks** — one logical change per commit, with
  the task ID in the message (`S3-02: ...`).
- **New features are requirements, not surprises.** Add them to
  `docs/BACKLOG.md` with a new ID rather than silently expanding a stage.
- **Decisions are recorded** in `docs/DECISIONS.md` so a future session (or
  human) knows why things are the way they are.
- **`main` is protected.** Direct pushes are rejected, and a PR will not merge
  until typecheck, lint, tests, format, the Expo config load and a real Metro
  export all pass. `enforce_admins` is on, so this applies to the owner too.

## Provenance

`reference/pack-weigh-web/` is the original Claude artifact, saved from the web
and de-minified. It is kept for reference during the Stage 1 port and is not part
of the app build. See [`docs/DECISIONS.md`](docs/DECISIONS.md#d9) for what was
recovered from it and what was not.
