# release-deployment-workflow.md — Release & Deployment Workflow Standard

**Status:** binding for all release/deployment work. Sits beside `do-not-touch.md`,
`architecture-rules.md`, and `care-charter.md` in authority.

**Purpose:** make releases fast, deterministic, and consistent; eliminate
unnecessary approval loops; preserve safety; and stop re-deriving the same Git
reasoning every session. When repository policy and these rules already define
the next step, **execute it** — do not ask for confirmation.

---

## 0. Golden rule

> Prefer deterministic execution over repeated decision-making. If validation is
> green and scope is clean, proceed through the workflow without asking. Stop
> **only** for the explicit blocking conditions in §7.

---

## 1. Branching strategy

- Feature/fix work **always** starts on a `feature/*` or `fix/*` branch.
- **Never develop directly on `main`.** `main` is the production branch (see §6).
- A branch that is declared "frozen" is never rewritten or committed to again;
  releases proceed from a clean branch (see §4), not by mutating the frozen one.

---

## 2. Validation pipeline (must be green before any deployment)

Run, in the project's terms:

- `npx tsc --noEmit` — typecheck (the only tolerated output is the pre-existing
  generated `.next/types` `/activate` route artifact, which is unrelated).
- `npm run test:a11y` — accessibility regression suite (no DB required).
- `npm run test:integration` / `npm run test:unit` — project tests (as applicable
  to the change).
- Any other project-specific validation the change touches.

**The pipeline must be green before continuing.** A red pipeline is a blocking
condition (§7). Do not "deploy anyway" past a real failure.

---

## 3. Scope verification (every release)

Before deploying, always compare the working branch against the **latest**
production ref:

```
git fetch origin --prune
git log --oneline origin/main..<branch>      # exactly what would deploy
```

Verify that **only approved work** is in that range. Explicitly check for
unrelated commits/files (e.g. unrelated features) that must not ship:

```
git log --oneline origin/main..<branch> | grep -iE "<unrelated-keywords>"
git diff --stat origin/main..<branch>
```

If the range contains anything not approved for this release, apply §4.

---

## 4. Automatic clean-branch policy

If unrelated commits are detected in the deploy range, **do not stop for
approval** — resolve it deterministically:

1. Create a **new** clean branch from the latest `origin/main`
   (prefer an isolated `git worktree` so the working tree and any frozen branch
   are never disturbed):
   `git worktree add <tmp> -b <branch>-clean origin/main`
2. Cherry-pick **only** the approved commits, in their original order.
3. **Never rewrite or modify** the original/frozen branch.
4. Resolve conflicts while preserving the approved implementation exactly:
   - If a file was intentionally removed on `main` (dead-code cleanup), keep it
     removed; drop the moot change.
   - Keep `main`'s surrounding context; re-apply only the approved lines.
5. Continue the release from the clean branch.

**Stop only if cherry-picking cannot be completed safely** — i.e. a conflict
cannot be resolved without guessing at intent, or resolution would alter approved
behavior. A merely mechanical conflict is resolved, not escalated.

Note: cherry-picking creates new commit SHAs on the clean branch. This is
expected and is **not** "rewriting history" of the original branch — the original
branch is left byte-for-byte intact.

---

## 5. Deployment workflow

Once validation (§2) is green and scope (§3/§4) is clean:

1. `git push` the release branch to `origin`.
2. **PR path (default):** open a PR into `main`.
   - `gh` CLI may be absent; if so, provide the compare/PR URL:
     `https://github.com/<owner>/<repo>/compare/main...<branch>?expand=1`
3. **Direct-to-production path:** only when repository policy **explicitly**
   allows it for this release. It must be a **fast-forward** — verify first:
   `git merge-base --is-ancestor origin/main <branch>` → must be YES.
   Then: `git push origin <branch>:main`.
4. **Verify the deployment** (§6): confirm the production commit SHA and that the
   live site serves the new build (poll a public, change-specific marker; see §8).

Avoid unnecessary confirmation requests once all required checks have passed.

---

## 6. Production vs Preview (never confuse these)

- **Production = https://getsocialcrm.com** — served only by deployments from the
  Vercel **Production Branch** (`main`). `APP_URL`/`NEXT_PUBLIC_APP_URL` =
  `https://getsocialcrm.com`.
- **`*.vercel.app` URLs are Preview Deployments only** — Vercel auto-creates one
  for **every push to any branch** (e.g.
  `socialcrm-git-<branch>-almayos-projects.vercel.app`). They are isolated test
  builds, may use Preview-env vars, and **do not affect production**.
- **Never refer to a Preview URL as production.** "The live site" / "production" is
  always `getsocialcrm.com`. A feature-branch push does not change production.

---

## 7. Blocking conditions (the only reasons to stop automatically)

Stop and report **only** for:

1. **Failing validation** — any item in §2 not green.
2. **Unresolved merge/cherry-pick conflicts** — resolution would require guessing
   intent or altering approved behavior (§4).
3. **Repository protection rules** — a push/merge rejected by branch protection.
4. **Deployment failures** — push rejected, build failed, or the live site does
   not serve the new build within the expected window.
5. **Explicit production risk** — the range would deploy unapproved/unrelated work
   (before applying §4), destructive/irreversible actions beyond the approved
   scope, or a non-fast-forward direct-to-`main` push.

**Do not stop for** hypothetical risks, "just to be safe" checks, or repeated
confirmation of steps that policy already authorizes.

---

## 8. Reporting (every deployment)

Every deployment report must include:

- **Deployed branch**
- **Deployed commit SHA** (the new production SHA)
- **Validation results** (typecheck + test suites, pass/fail)
- **Deployment status** (triggered / completed)
- **Production URL** and how "live" was verified (public marker + confirmation)
- **Remaining blockers** (if any)

Report outcomes faithfully: distinguish "accepted/triggered" from "confirmed
live." Never claim production is live without a concrete verification signal.

---

## 8b. Database schema contract (AUTHORITATIVE)

**Status:** binding. Establishes who owns the schema, how a database is built,
and how a migration reaches production.

### Ownership

| Layer | Owner | Where |
| --- | --- | --- |
| **Baseline** — the starting point | A captured `pg_dump --schema-only` snapshot | `db/baseline/schema-baseline.sql` + `baseline.json` |
| **Everything after the baseline** | **Knex, exclusively** | `migrations/*.cjs`, tracked in `knex_migrations` |

The baseline exists because the knex chain cannot build a database from zero and
was never designed to: it was retrofitted in 2026-03 onto a database first built
by Prisma (2024-07 → 2025-01) and then hand-edited for ~14 months with no
migration system. 21 of the 25 tables the app queries are created by nothing in
this repository. Full history:
`claude/research/engineering/migration-chain-drift-decision.md`.

**The baseline is not migration history and holds no authority over it.** It is
where the chain starts. Never fold an ordinary schema change into it — write a
migration, exactly as before.

### Fresh database

```
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
npm run db:bootstrap        # loads the baseline, stamps what it already contains
npm run migrate             # applies everything after it
```

`__tests__/globalSetup.ts` does this once per test run. DB-backed test runs must
be serialized (`npm run test:db`, i.e. `--no-file-parallelism`): one shared
database cannot give parallel files independent data.

### Production migration procedure

1. Migrations are applied **manually, before the deploy**, never by it.
2. Confirm what would run: `npx knex --knexfile knexfile.cjs migrate:list`.
3. Apply: `npm run migrate` against the production `DATABASE_URL`.
   **Not** `npm run db:migrate:prod` — that script runs the LEGACY runner over
   `db/migrations/*.sql` and would report success without applying anything from
   the knex chain.
4. Record the applied migration filenames and the resulting commit SHA in the
   deployment report (§8).
5. Only then deploy the code.

### Migrations are NOT run during the Vercel build

`vercel.json` has no build override and `package.json`'s `build` is plain
`next build`. This is deliberate:

- Vercel builds run concurrently (preview + production, retries, redeploys).
  Concurrent migrations against one database is a data-integrity hazard that
  `knex_migrations_lock` mitigates but does not make safe.
- A build runs on every push to every branch. Migrations must run once, at a
  moment a human chose.
- A failed migration inside a build surfaces as an opaque build failure, at the
  worst possible time to reason about schema state.

**Never add a migration step to `build`, `prebuild`, `postinstall`, or
`vercel.json`.**

### CI verification

`.github/workflows/schema.yml` runs on any PR touching `migrations/`,
`db/baseline/`, the bootstrap scripts, `knexfile.cjs`, or the test globalSetup.
It builds a fresh Postgres from the baseline, applies every migration, and
asserts the invariant:

> **baseline → current knex migrations → valid current schema**

plus idempotency (a second `migrate:latest` is a no-op), that bootstrap refuses a
populated database, and that the newest migration is reversible.

**A migration that cannot apply from zero does not merge.**

### Safety rules

- **Applied migrations are immutable.** Never edit the `up()`/`down()` of a
  migration that has run anywhere; environments that already ran it will not
  re-run it, so the edit silently diverges them.
- **Never delete a migration file.** Knex refuses to run when a migration
  recorded in `knex_migrations` is missing from the directory.
- `migrations/` is **append-only**.
- **Never add a second migration for something the chain already does.** Check
  `migrations/` before writing one — a duplicate CHECK-constraint migration drops
  and re-adds a byte-equivalent constraint in production for no benefit.
- **Bootstrap never runs against production.** It refuses hosted-provider URLs,
  remote hosts (without `BOOTSTRAP_ALLOW_REMOTE=1`), non-test database names
  (without an exact `BOOTSTRAP_CONFIRM_DB`), and — the rule that actually
  protects data — any database that already contains tables.
- **The baseline is regenerated only by `npm run db:baseline`**, never by hand,
  and only from a database whose migration chain is current. A hand-written
  baseline is a guess, and the details a human skips (generated columns, sequence
  ownership, enum order, partial-index predicates, view bodies) are exactly the
  ones that decide whether a migration behaves the same in CI as in production.
- Regenerating the baseline requires re-verifying a fresh build in the same PR.

---

## 9. Accessibility workflow (closed audit)

- The audited WCAG 2.2 AA remediation is **closed**. Its regression suite
  (`__tests__/a11y/`, `npm run test:a11y`) is the frozen baseline — extend it for
  new fixes; do not weaken existing assertions.
- A future accessibility issue is a **new, independently-tracked defect** — never
  bundled into the closed audit and never used to reopen closed root causes
  **unless it is a proven regression** in one of the completed fixes.
- **Never reopen completed accessibility work automatically.**

---

## 10. Philosophy

Deterministic execution over repeated decision-making. When repository policy and
project rules already define the next step, **execute it** rather than asking.
Human confirmation is reserved for genuine, named blockers (§7) — not for steps
the standard already authorizes.
