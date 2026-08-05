# onboarding-entry-architecture-comparison.md

**Status:** architectural comparison. **No code written. Nothing implemented.**
**Question:** should new desktop registrations enter the app directly, leaving `/activate`
dedicated to mobile + Facebook activation — or should they keep passing through `/activate` with
a skip control?
**Supersedes:** the Phase-1 recommendation in `onboarding-gate-removal-implementation-plan.md` §7.
That document's audit (§1–§6, §9) stands unchanged; only the chosen mechanism changes.

---

## 0. The finding that settles it

`components/auth/WelcomeToast.tsx` is **already mounted on `/leads`** (`leads/page.tsx:62`).
It already:

- reads `?welcome` from the URL,
- calls `trackCompleteRegistration()` — the Meta Pixel `CompleteRegistration` event,
- dedupes in `localStorage` under its own key,
- strips the param via `router.replace`,
- and suppresses its greeting when `trialStatus === 'NEVER_STARTED'`, *"When the Welcome Trial
  Modal is about to show, it IS the welcome — suppress the toast but keep the pixel and the
  seen-marker so registration attribution never depends on trial UI."*

That last comment describes, precisely, a registrant landing on `/leads` while the trial modal
opens. **That flow does not exist today.** The only producer of a `welcome` param is
`actions/agencies.ts:80`, which points at `/activate`. So `WelcomeToast` is currently unreachable
in production, and `components/activation/RegistrationPixel.tsx` is a near-duplicate of it living
on the route that *is* reachable.

**Consequence:** HC-3 in the migration plan — "changing the registration redirect silently breaks
Meta attribution, the single easiest way to break the funnel" — is wrong. The destination
already has a working pixel. That coupling is already solved, by a component someone wrote for
exactly this flow. This is the fact that flips the recommendation; the rest of this document is
the comparison it enables.

Two corollaries, both verified:

- **Nothing in the UI links to `/activate`.** Repo-wide grep: the only inbound references are
  `layout.tsx:40` (mobile) and `layout.tsx:42` (the gate). No nav item, no card, no button.
  Remove those two redirects as entry paths and `/activate` *is* the mobile route, by default,
  with no work.
- **`LeadsFirstRun` already links Facebook to `/settings/facebook?section=facebook`**
  (`LeadsFirstRun.tsx:88`) and WhatsApp to `?section=whatsapp` (:50, :79). The desktop connect
  surface already exists and is already wired from the first-run screen.

---

## 1. The two architectures, precisely

### Option A — skip control (the current plan)

```
register → /activate?welcome=1 → [Connect Facebook]  or  [small "skip"]
                                       ↓                      ↓
                                 completeOnboarding()   completeOnboarding()
                                       ↓                      ↓
                                            (app) layout gate passes
                                                   ↓
                                            /dashboard → /leads → LeadsFirstRun
```

Gate stays. Registration redirect stays. An escape hatch is added, flag-gated, mobile-suppressed.

### Option B — direct entry

```
register (sets onboardingCompletedAt in the same transaction)
   → /leads?welcome=<firstName>  →  LeadsFirstRun  →  [WhatsApp] [Facebook] [add lead] [import]
                                          ↓ Facebook
                                    /settings/facebook?section=facebook   (already wired)

/activate  →  mobile only (layout:40) + the stuck NULL cohort until backfilled (layout:42)
```

Gate stays *in the code* but stops firing for new agencies, because they are onboarded on
creation. `/activate` becomes single-purpose.

---

## 2. Option B has two implementations, and only one is safe

This is the crux, and getting it wrong inverts the safety verdict.

### B-1 — "delete the gate" (`layout.tsx:42`) — **do not do this**

New agencies keep `onboardingCompletedAt = NULL` and are let through because the check is gone.

- Rollback (restoring the line, or flipping a flag that guards it) **ejects every user who
  entered while it was off**, mid-session, back to `/activate` — including people who imported
  leads and started working. That is precisely the failure `do-not-touch.md` §7 and the fail-open
  design of `isOnboarded()` exist to prevent.
- `onboardingCompletedAt` becomes vestigial: written by the FB flow, read by nothing but the
  `/activate` bounce. A column that means nothing is a maintenance liability.

### B-2 — "onboard at registration" — **the correct implementation**

`addAgency()` writes `onboardingCompletedAt` inside the transaction that already inserts the
agency row (`actions/agencies.ts:22`), and redirects to `/leads?welcome=<firstName>`.

- **The gate is never touched.** `layout.tsx:42` keeps working, keeps protecting the existing NULL
  cohort, keeps failing open on DB error.
- **Rollback is a perfect no-op for existing users.** Revert two lines in one file; new agencies
  go back to `/activate`; everyone already registered has the column set and is never ejected.
  This is *strictly safer* than Option A's rollback, which the plan itself described as "partial
  and one-way per agency."
- **The column gains a coherent meaning** — "this agency has completed registration and may enter"
  — which is what `isOnboarded()` was named for and what its docblock already claims it means
  (*"deliberately never queries facebook_pages… so the gate stays decoupled from
  FB/WhatsApp/Instagram/imports forever"*).
- `completeOnboarding()`'s `whereNull` guard makes the later FB-connect call a silent no-op. Its
  return value is discarded by `actions/activation.ts:52–56` — verified, no caller reads it — so
  nothing breaks.

**Everything below compares Option A against B-2.** B-1 is dominated by both and is excluded.

---

## 3. Comparison

### 3.1 Simplicity

| | **Option A (skip)** | **Option B-2 (direct entry)** |
| --- | --- | --- |
| Files changed | ~7 | **2** (`actions/agencies.ts`, plus deleting a now-dead component) |
| New modules | Rollout flag module | **None** |
| New props threaded | `skipEnabled` → page → experience → 2 screens | **None** |
| New user-facing UI | Skip control + copy, in 2 screen states | **None** — `LeadsFirstRun` already exists |
| New code paths | Second onboarding-completion path in the controller | **None** — one path: registration |
| Net component count | **+1 flag module, +1 control** | **−1** (`RegistrationPixel` becomes dead; `WelcomeToast` activates) |

Option A adds an escape from a wall. Option B-2 removes the wall. **Net complexity moves in
opposite directions.**

### 3.2 Safety

| Dimension | **Option A** | **Option B-2** |
| --- | --- | --- |
| Rollback | Partial, one-way per agency. Skipped agencies stay released forever | **Full and harmless.** Revert two lines; nobody already in is ejected |
| Blast radius | `/activate` render path + the controller + the flag | One server action's final two statements |
| Gate integrity | Untouched | Untouched |
| Schema / data migration | None | None |
| Meta attribution | Preserved (`RegistrationPixel` unchanged) | Preserved — **`WelcomeToast` already fires it on `/leads`** (§0) |
| Mobile interaction | **EC-3 — the highest-risk item in the plan.** A skip visible on a phone sets the column and still bounces to `/activate`, reading as a loop | **Eliminated.** Nothing new renders on `/activate`; `layout:40` is untouched |
| Redirect-loop risk (T-1) | Real — two files must be reasoned about together | **Near zero** — no redirect logic changes |
| Activation FSM | Must add a handler beside the reducer without adding a state | **Untouched** |
| Test surface | New flag tests; skip copy must satisfy the banned-terms assertions | **None** — no activation copy added |

Option A's two named high-risk items — EC-3 (mobile skip) and T-1 (redirect loop) — **do not
exist under B-2**, because B-2 adds nothing to `/activate` and changes no redirect logic in the
layout.

### 3.3 Long-term maintainability

**Option A leaves permanent artifacts:**

- A flag that either lives forever or needs a cleanup PR nobody schedules.
- `/activate` stays **triple-purpose**: mobile experience, onboarding gate destination, *and*
  Facebook activation flow — with a control that must be suppressed for one of those three
  audiences. Every future change to that route must re-derive which audience it is serving.
- Two ways to become onboarded (connect, skip), both client-side, both calling the same action.
- `RegistrationPixel` / `WelcomeToast` duplication persists indefinitely — two components, two
  localStorage keys, one concern, on two routes.

**Option B-2 leaves none:**

- `/activate` becomes **single-purpose: the mobile experience.** One audience, one reason to
  exist. That is a genuine reduction in the hardest kind of complexity — a route whose behaviour
  depends on who is asking.
- One way to become onboarded: registration.
- The duplicate pixel collapses to the one that was written for this flow.
- `onboardingCompletedAt` means what its name says.

There is a general principle here worth stating: **Option A adds a mechanism whose only job is to
undo another mechanism.** Two constructs now have to be understood and kept consistent, forever,
where before there was one. Deleting the requirement removes both.

---

## 4. What Option B-2 actually costs — the honest side

**4.1 The desktop cinematic activation experience becomes unreachable.**
`ActivationHero` + `ActivationVideoPanel` + the split-screen light/dark composition render only
at ≥1000px. If desktop registrations never reach `/activate`, that branch is dead on desktop
(mobile keeps its stacked flow). Nothing in the UI links there (§0), so it will not be reached by
accident. This is real, polished work being retired — the largest single cost of Option B, and
the one Option A avoids entirely.

*Recoverable if wanted:* point `LeadsFirstRun`'s Facebook card at `/activate?connect=1` and relax
the `activate/page.tsx:12` bounce for that intent. That converts the cinematic screen from a
*mandatory wall* into an *opt-in connect flow* — arguably its best use. Not required for B-2;
listed as a follow-up, not a dependency.

**4.2 Facebook connect rate will fall more under B than under A.**
This is the strongest argument for Option A and must not be waved away. Option A keeps a
full-screen, single-purpose Facebook pitch as the first thing every registrant sees, with the
escape deliberately secondary. Option B replaces it with `LeadsFirstRun`, where Facebook is **one
of four equal cards** — and where the *WhatsApp* card currently carries the `מומלץ` badge
(`LeadsFirstRun.tsx:84`), not Facebook.

Guardrail #2 from the plan (*absolute weekly Facebook connections must not fall*) is materially
more at risk under B. Two mitigations, both cheap and both inside an existing component:

- Reconsider which card carries `מומלץ` in the `metaConnected === false` branch. If Facebook is
  the strategically highest-value connection — it feeds the CAPI conversion and the Meta ad
  optimization loop — the badge arguably belongs there, or on whichever card matches the user's
  answer if the segmentation question is ever added.
- Keep the connect cards permanently visible until connected. They already are.

**4.3 It does not, by itself, release the stuck cohort.**
Agencies registered after 2026-06-30 with `onboardingCompletedAt IS NULL` still hit `layout:42`.
Option B-2 fixes the *inflow*; it does not fix the *backlog*. Three ways to handle it:

| Approach | Assessment |
| --- | --- |
| **One-time backfill** — `UPDATE agencies SET "onboardingCompletedAt" = now() WHERE … IS NULL` | **Recommended.** Exact precedent: `migrations/20260630000001` ran this identical statement. Fully reversible if the affected ids are captured first (`SELECT id … WHERE … IS NULL` → saved) |
| Keep a skip control for them only | Reintroduces every Option A cost to serve a shrinking, finite population |
| Leave them gated | Unacceptable — they are the population that motivated the whole review |

The backfill releases the cohort all at once, so §5.3 of the plan still applies: a `trial_started`
spike and a `trial_expired` echo seven days later. That argues for doing the backfill in batches,
or on a separate day from the inflow change, so the two effects can be read independently.

**4.4 The `?welcome` param must carry the first name, not `1`.**
`WelcomeToast` builds its greeting from `welcomeParam.trim()`. Redirecting with `?welcome=1`
would render **"ברוך הבא ל-SocialCRM, 1"**. `RegistrationPixel` ignores the value, which is why
`welcome=1` is harmless today. A concrete, easily-missed detail — not a risk to the architecture,
but a defect if it ships.

**4.5 `/leads` vs `/dashboard` as the redirect target.**
`redirect()` does not preserve query strings, and `DashboardPage.tsx:23` redirects empty agencies
to `/leads` — so `redirect('/dashboard?welcome=…')` would **drop the param before `WelcomeToast`
ever renders**, silently killing registration attribution. Registration must target
`/leads?welcome=…` directly. This is the one genuine trap in Option B, and it is the mirror image
of the HC-3 concern that turned out not to apply.

---

## 5. Verdict

| Criterion | Winner |
| --- | --- |
| **Simpler** | **Option B-2**, decisively. 2 files vs. 7; removes a construct rather than adding one that undoes it |
| **Safer** | **Option B-2.** Full harmless rollback vs. partial one-way; eliminates EC-3 and T-1 outright; touches no redirect logic |
| **Easier to maintain** | **Option B-2**, decisively. `/activate` becomes single-purpose; no flag to retire; duplicate pixel collapses |
| **Preserves Facebook connect rate** | **Option A** — the only criterion it wins, and it is a product question, not an architectural one |

**Recommendation: Option B-2**, plus a separately-scheduled backfill for the stuck cohort.

The plan's §1–§6 and §9 audit is unaffected. What changes:

- **Phase 0 (instrumentation) is unchanged and still ships first.** Everything in §6.2 still
  applies, and `activation_skipped` is replaced by nothing — under B-2 there is no skip to track.
  `connection_deferred` becomes more important, not less: with no wall, "did not connect" is the
  default state and needs its own signal.
- **Phase 0.5 (EC-16, the trial-unreachable-on-narrow-desktop hole) becomes *more* urgent**, not
  less. B-2 sends every new registrant into `(app)` directly, so any agency that reaches the app
  without a reachable trial-start path is silently capped at `FREE_LEAD_LIMIT = 50`. This is now
  the highest-priority prerequisite.
- **Phase 1 is replaced** by the two-line `addAgency` change.
- **Phase 3 (registration routing) is no longer a separate high-risk phase** — it *is* the change,
  and it is low-risk because the destination pixel already exists.
- **Phase 4 (mobile) remains untouched and out of scope.**

The rollout can still be flagged if you want a ramp, but the flag would guard *the redirect target
in one server action*, not a UI control — and unlike Option A's flag, it is genuinely disposable
once the change proves out.

### Confidence

| Claim | Confidence |
| --- | --- |
| `WelcomeToast` already fires `CompleteRegistration` on `/leads` and is currently unreachable | **Very high** — read both components and grepped every `welcome` producer |
| B-2 is simpler and easier to maintain than A | **Very high** |
| B-2 is safer than A, given onboarding is written at registration | **High** — rests on the rollback argument in §2 |
| B-1 ("delete the gate") is worse than both | **High** |
| Facebook connect rate falls further under B than under A | **Medium-high** — directionally near-certain, magnitude unknown; this is what the ramp exists to measure |
| Retiring the desktop cinematic screen is an acceptable cost | **Medium** — a product/brand judgement, not an engineering one. Yours to make |
| `?welcome` must carry the first name and target `/leads` directly | **Very high** — read `WelcomeToast:29–33` and `DashboardPage:23` |

### What I would still not bundle in

The mobile gate, trial-start timing, the segmentation question, and the per-user connection reads
(HC-4). Each remains a separate decision with its own plan.

---

**Awaiting explicit approval before any code is written.**
