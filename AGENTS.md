This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Required: test-driven development

**Load the `tdd` skill before writing or changing any implementation code** —
anything under `src/` that is not a test. This is not optional and not
advisory. A separate agent writes the tests, a separate agent writes the code,
and the code is fixed when it disagrees with the tests. Tests are the
specification.

```bash
npm test                      # jest
npm run typecheck             # tsc --noEmit
npm run lint                  # expo lint
```

CI runs these on every PR and the merge is blocked until they pass, so a green
local run is a precondition, not a formality. The same gate plus a real Metro
export is what `S1-29` and every later stage depend on.

## This app in one paragraph

A shared pack-weight planner for hunting trips. Each hunter maintains their own
pack; trip members can read each other's packs and compare loadouts by category
and total weight. Nobody edits anybody else's pack — which means offline writes
can never conflict, and that is the central design fact (decision D3).

The numbers users trust — base weight, total, per-category breakdown — are the
whole product. A wrong total is worse than a crash, because it is invisible and
gets believed. `src/lib/weights.ts` is the only place any weight is computed;
never add a second implementation. Full context in `docs/`, and the staged plan
in `docs/ROADMAP.md` with the task list in `docs/BACKLOG.md`.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.config.ts` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
