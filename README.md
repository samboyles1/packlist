# Packlist

A shared pack-weight planner for hunting trips. Every hunter maintains their own
pack; trip members can see and compare each other's loadouts by category and
total weight.

Currently at **Stage 0 — planning**. No application code exists yet. The product
is being built in stages; see [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Status

| | |
|---|---|
| Stack | React Native + Expo (TypeScript), Supabase (Postgres/Auth/Realtime) |
| Stage | 0 — Foundations |
| Repo | Local only, no remote configured yet |
| App name | Placeholder — single constant to rename later |

## Documents

| Doc | Purpose |
|---|---|
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architecture decisions and why. New decisions get appended here. |
| [`docs/PLAN.md`](docs/PLAN.md) | Product scope, architecture, risks, things only the owner can do. |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Supabase schema, row-level security policies, weight engine. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Stages 0–9, what "done" means for each. |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | The iterated task checklist. Stable task IDs. |

## Working agreement

- **Work in stages.** Finish and merge a stage before starting the next.
- **Commit in small, reviewable chunks** — one logical change per commit, with
  the task ID in the message (`S3-02: ...`).
- **New features are requirements, not surprises.** Add them to
  `docs/BACKLOG.md` with a new ID rather than silently expanding a stage.
- **Decisions are recorded** in `docs/DECISIONS.md` so a future session (or
  human) knows why things are the way they are.

## Provenance

`reference/pack-weigh-web/` is the original Claude artifact, saved from the web
and de-minified. It is kept for reference during the Stage 1 port and is not part
of the app build. See [`docs/DECISIONS.md`](docs/DECISIONS.md#d9) for what was
recovered from it and what was not.
