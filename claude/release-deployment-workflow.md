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
