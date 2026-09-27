---
name: tdd
description: Use for ANY implementation work in this repo - writing or changing src/**, adding a feature, fixing a bug, touching the weight engine, data layer, or UI. Enforces test-first development where a separate test-writing agent specifies the behaviour and a separate implementing agent makes it pass. Tests are the spec; when code and tests disagree, the code is fixed.
---

# TDD: separate spec from implementation

Two different agents, in order. The point of the split is that neither one can
quietly redefine the other to whatever is easy.

- **Test agent** decides what correct behaviour *is*.
- **Implement agent** decides how to make it true.

## Why this matters here

This app has a handful of numbers that users will trust absolutely — base
weight, total weight, the per-category breakdown other hunters compare their
loadouts against. A subtly wrong total is worse than a crash: it is invisible,
and it gets believed. The weight engine already has a history of this. In
`docs/PLAN.md` risk R7, and in commit `a2d0434`, three tests failed on the
first run and caught two real bugs — including per-category figures that could
never be reconciled with the pack total. Those tests were written against
figures taken from the original artifact, not invented.

The same discipline is what makes the Stage 2 RLS policies trustworthy. If
`PLAN.md` R6 holds, a test proves a user cannot read a stranger's pack. That
proof is worth nothing if the same agent wrote the policy and the test and then
agreed with itself.

## Procedure

Work one backlog task (or one tight group) at a time. Note the task ID from
`docs/BACKLOG.md` — it goes in the commit message.

### 1. Snapshot the test files

Before anything else, record the current state of every test file. This is the
guard that makes step 4 checkable rather than a promise.

```bash
git ls-files 'src/**/*.test.ts' 'src/**/*.test.tsx' 'src/__tests__/**' | xargs shasum
```

### 2. Test agent writes the tests

Dispatch the `tdd-tests` agent. It writes tests only and implements nothing.

Requirements it must satisfy:

- Tests describe **observable behaviour**, named for what the user sees, not for
  the function's internals.
- Where a real figure exists, use it. For weight work, take numbers from
  `reference/pack-weigh-web` or from the figures already pinned in
  `src/__tests__/weights.test.ts`. Invented numbers cannot catch a wrong
  formula; the artifact's can.
- Include the boundary and degenerate cases: empty input, zero, missing parent,
  cycle, dangling reference, the largest realistic value.
- **Assert the invariants, not just the outputs.** R7 is a class of bug where
  each screen's number is right on its own and wrong together. A test that
  checks `categoryBreakdown` sums to `summarisePack` catches what two separate
  per-function tests cannot.
- A test must fail if the behaviour is wrong. If it would also pass against a
  stub, it is not specifying anything.

### 3. Watch them fail

```bash
npm test -- <path>
```

Confirm each new test fails **for the right reason** — the assertion fails, not
a typo, an import error, or a missing export. A test that fails for the wrong
reason will pass for the wrong reason later.

Commit the failing tests. A commit whose tests fail is a legitimate, reviewable
statement of intent:

```
S1-XX: specify <behaviour> (failing)
```

### 4. Implement agent makes them pass

Dispatch the `tdd-impl` agent. It does **not** get to touch test files.

```bash
npm test && npm run typecheck && npm run lint
```

### 5. Verify the guard held

Re-run the snapshot from step 1 and confirm the hashes are **unchanged**. The
implementing agent must not have altered a single test to reach green.

```bash
git ls-files 'src/**/*.test.ts' 'src/**/*.test.tsx' 'src/__tests__/**' | xargs shasum
```

If anything changed, that is the failure mode this workflow exists to prevent.
Reset the test file, restore the red state, and redo the step.

### 6. If a test turns out to be wrong

This is the hard case, and it is the one that quietly destroys TDD if left
undefined. A wrong test is a **spec bug, and it is corrected by the test agent,
never by the implementer.**

1. The implementing agent stops and reports. It does not edit the test. It states
   what it believes is wrong, and what it observed.
2. Confirm the claim against the source of truth — `docs/DATA-MODEL.md`,
   `docs/PLAN.md`, `docs/DECISIONS.md`, or the original artifact. Tests encode
   documented decisions; if a test contradicts a decision, the *decision* is what
   is in question.
3. If the test was genuinely wrong, dispatch `tdd-tests` again with the specific
   evidence. It revises the test.
4. Record it in the commit body, not just the subject:

```
S1-XX: correct <behaviour> spec

The test asserted <X>. That contradicts docs/DATA-MODEL.md, which specifies <Y>.
Code was already correct for <Y>; the test was wrong. Tests changed by the test
agent, not the implementing agent.
```

The trail matters. A test quietly edited to match the code is indistinguishable
from a test written to match the code, and the second one is worthless.

### 7. Verify the whole gate

```bash
npm run typecheck && npm run lint && npm test && npx expo export --platform ios --output-dir /tmp/verify
```

CI runs the same checks and blocks the merge, but run them locally first — a
failed CI run costs a round trip.

Commit:

```
S1-XX: <what changed>
```

### 8. Tick the backlog

Update `docs/BACKLOG.md` in the same commit. The backlog is the source of truth
for what happens next; a landed feature that is still unticked will be
re-implemented or lost.

## What the test agent may not do

- Implement anything, even "just a stub so it passes".
- Weaken an assertion, add `.skip`, or loosen a type to get green.
- Delete or rewrite a test to match an implementation, without going back
  through step 6.

## What the implement agent may not do

- Edit, skip, delete, or reorder any test.
- Change a public signature to make a test compile.
- Report "done" with a failing or skipped test.

If it believes a test is wrong, it stops and reports. That is a valid outcome and
is treated as a success of the workflow, not a failure of it.

## Agents

- `tdd-tests` — writes and owns the specification
- ` `tdd-impl` — owns the implementation

If a custom agent is unavailable in the current session, run two separate
`general` subagents using the prompts from `.opencode/agent/tdd-tests.md` and
`.opencode/agent/tdd-impl.md`, in that order, as two distinct invocations. The
separation is the point; the specific agent is not.
