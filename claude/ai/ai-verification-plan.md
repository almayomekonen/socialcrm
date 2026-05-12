# ai-verification-plan.md — Operational Verification Pass

This is a **product-level** verification plan for the AI layer in production today. Its purpose is one decision: **is the current AI surface trustworthy enough to expand into larger surfaces (side copilot, agent workflows, etc.)?**

It is not a release-gate per feature — that's `ai-evaluation-checklist.md`. This plan asks: now that we've shipped several AI features, do they actually behave like a reliable embedded CRM capability?

---

## 1. SCOPE — WHAT WE ARE VERIFYING

The cumulative AI surface as of today:

- **Foundation**: provider router (`lib/ai/router.ts`), env config, healthcheck endpoint, structured logging, daily cap, allowlist gating.
- **Lead intelligence**: `LeadIntelligenceCard` on the lead summary page, with skeleton, refresh button, per-lead cache.
- **Prompt v4**: editorial discipline (4-layer defense), Hebrew operational tone, sanitizer.
- **Phase 2 partial pre-warm**: `scheduleLeadIntelWarm` wired only to `actions/clients.ts:updateLead`. Other triggers planned but not landed.
- **Phase 2A — Follow-up Pulse**: rule-based chip on `/dashboard` rows. No AI calls in this layer.

Out of scope: anything still on the roadmap (other prewarm triggers, cross-lead intelligence, copilot, agents).

---

## 2. RISK-PRIORITIZED MATRIX

Three columns. Anything in column 1 must pass before we expand the AI footprint. Column 2 is observed-in-production. Column 3 is deferred.

| Concern | Must-pass before expansion | Monitor during rollout | Future hardening |
|---|---|---|---|
| **Cross-agency data isolation** | ✅ test required | log audit | per-tenant prompt envelopes |
| **Cache poisoning on failure** | ✅ test required | log audit | — |
| **Provider fallback chain works** | ✅ manual + log audit | provider-distribution dashboard | provider health probes |
| **AI failure never breaks page** | ✅ manual scenarios | error-rate watch | — |
| **Editorial quality on real leads** | ✅ 3-lead review | weekly spot-check | LLM-as-judge |
| **Cost cap enforced** | ✅ manual scenario | daily cost log | per-feature budget |
| **Pre-warm cooldown + dedup** | ✅ manual scenarios | log audit | true queue when scale demands |
| **Prompt-version cache bust** | ✅ test required | — | — |
| **Sanitizer catches leakage** | ✅ unit test | pollution-event count | — |
| **Refresh rate limit** | ✅ manual scenario | log audit | — |
| **Dashboard chip frequency** | observe in prod | weekly count | tune thresholds |
| **Mobile UX (≤375px)** | ✅ manual | — | — |
| **Perceived latency** | ✅ subjective pass | — | warmer pre-gen on more triggers |
| **Cold path latency** | ✅ ≤6s on slowest provider | P95 watch | pre-warm coverage expansion |
| **Warm path latency** | ✅ ≤300ms | P95 watch | — |

---

## 3. PER-AREA VERIFICATION METHODS

Each area: **what** we verify, **how** (manual / automated / scripted), **pass/fail criteria**, **where to look**.

### 3.1 Cold → Warm Lifecycle

**What:** the `getLeadIntelligence(leadId)` chain caches correctly, and the cache is invalidated by the right events.

**How — manual:**

1. Pick a lead never opened. Open `/clients/<id>/summary`.
2. Terminal: expect `[ai] router.call.start`, `runStructured.start`, then `runStructured.ok` with `latencyMs`.
3. Reload the same page within 60s. Terminal: expect **no** `runStructured` lines (cache hit). UI: card renders < 300ms.
4. Bump `PROMPT_VERSION` in `lib/ai/prompts/leadIntelligence.ts` from 4 → 5 locally, save, reload. Expect `runStructured.start` again (cache busted by version).

**How — automated** (proposed, see §4):

- Test asserts that two consecutive `getLeadIntelligence` calls invoke the router exactly once when the second hits within the cache window.
- Test asserts that bumping `PROMPT_VERSION` produces a fresh router call.

**Pass criteria:**

- Cold call: terminal shows full chain, latency under 6s on the worst provider.
- Warm call: zero router invocations.
- Version bump: router invoked exactly once.

### 3.2 Pre-warm System

**What:** `scheduleLeadIntelWarm` fires after mutations, respects cooldown and in-flight dedup, and never adds latency to the mutation response.

**How — manual:**

1. Open lead `/clients/<id>/summary`. Note current cache state (terminal logs).
2. Change the lead's status via the UI. Mutation response time should be unchanged (no AI in critical path).
3. Within 5s, terminal should show `prewarm.start reason=lead.update leadId=<id>` followed by `prewarm.ok`.
4. Reload `/clients/<id>/summary` immediately. Should be warm (no router call).

**Cooldown verification:**

5. Repeat step 2 immediately. Terminal should log `prewarm.skip reason=cooldown` (no second generation within 5 min).

**In-flight dedup verification:**

6. Open two browser tabs. Trigger the same lead's mutation in both within 1s. Terminal should show one `prewarm.start` and one `prewarm.skip reason=in-flight`.

**Pass criteria:**

- Mutation latency unchanged from pre-Phase-2 baseline (±50ms).
- One `prewarm.ok` per cooldown window.
- Dedup prevents double-generation.

> Only `updateLead` is wired today. Skip the same checks for `upsertLead`/`transferLeadToRep`/task mutations until they're wired.

### 3.3 Failure Handling

Six scenarios. Each must produce calm degradation.

| # | Scenario | How to simulate | Expected behavior |
|---|---|---|---|
| F1 | AI disabled | `AI_ENABLED=false`, restart | Lead page renders. No card, no error, no skeleton stuck. |
| F2 | Forbidden agency | Remove tenant from `AI_AGENCY_ALLOWLIST`, restart | Same as F1 — silent absence. |
| F3 | Bad primary key | Set `ANTHROPIC_API_KEY=invalid` | Terminal: `router.fallback` to Gemini. UI: card renders with the fallback provider. |
| F4 | All providers bad | Invalidate all three keys | Terminal: each provider classified-fail. `AiNonCacheableError` thrown. UI: card silently absent (or empty state per `ai-safety-boundaries.md` §6). Page renders. |
| F5 | Daily cap exceeded | Force the cost counter past cap (manual var poke) | UI: silently absent. Terminal: `over_quota` log. |
| F6 | Malformed model output | Use a debug provider that returns invalid JSON | Terminal: schema-validation fail. `AiNonCacheableError` thrown. **Cache must NOT persist the failure.** Next call re-attempts. |

**Pass criteria for all six:** core CRM continues working. No crashes, no broken layouts, no red error banners on the page. Logs are present and structured.

**Automated** (proposed, see §4): F4 and F6 are critical; both verifiable as integration tests with the router boundary mocked.

### 3.4 Editorial Quality

**The most important non-technical verification.** Bad text in production permanently damages trust.

**How — scripted:**

Run `scripts/evaluate-lead-intelligence.ts` against three representative leads (sparse / working / strong). The script already exists and prints v3 and v4 outputs side-by-side.

**Editorial rubric — the "AI cringe" detector:**

| Symptom | Pass / Fail | Where it shows up |
|---|---|---|
| English field name, enum, or `null` in any user-facing field | **FAIL** | summary, insights, action, sources |
| Banned phrase from `ai-editorial-guidelines.md` §4 | **FAIL** | any field |
| Reference to a date, name, amount, or interaction not in the input | **FAIL** | summary, insights, action |
| Confidence theater ("אני בטוח", "ללא ספק", numeric %) | **FAIL** | any field |
| Self-narration ("אני ממליץ", "אני חושב") | **FAIL** | any field |
| Empty insights array treated as broken UI | **FAIL** | UI render |
| Corporate echo: `פייפליין`, `סטגנציה`, `סיכון נטישה: בינוני` as a label | **FAIL (regression)** | any field |
| Conclusion, not description | **PASS** required | summary, insights |
| Sparse data → `confidence: low` + shorter output | **PASS** required | sparse-lead case |
| `sources` reads as human-readable categories with ` · ` separator | **PASS** required | UI |

**Process:**

- Every `PROMPT_VERSION` bump triggers a 3-lead eval run.
- Outputs pasted into the commit message or PR description.
- Any FAIL row blocks the merge.

**What "operationally useful" means:**

The summary, read aloud in 5 seconds, makes the user say "right, I'll do that." If the response to reading it is "and?" — it's not operationally useful, even if technically correct.

### 3.5 Dashboard Follow-up Chips

**What:** the chip is operational metadata, not noise.

**How — manual:**

1. Visit `/dashboard` with the test agency (40+ seeded leads).
2. Count chips visible across all three buckets. Note distribution by label.
3. Apply heuristics:

| Heuristic | Pass | Fail |
|---|---|---|
| Chip rate per bucket | 60–95% (dashboard buckets are pre-filtered for attention; high rate is normal) | 100% on every row in every bucket without differentiation between labels |
| Label distribution | At least 3 of 6 labels visible across the page | One label dominates >80% of chips |
| Label clarity | If you saw only the chip label, you'd know what to do | Label needs context to make sense |
| Visual hierarchy | Chip reads as "metadata" — eye finds lead name first | Chip competes with the lead name for attention |
| Color | All chips identical neutral palette | Any color escalation appears |

**Threshold tuning protocol:**

- Thresholds live as named constants near the top of `lib/ai/followUpRules.ts`.
- Tune **one threshold by ≤3 days** at a time. Observe for a session.
- Never restructure the decision tree without an explicit reason — structural change requires re-justifying frequency discipline.
- `on-track` returning `null` is sacred. Never weaken it to "always show something."

### 3.6 Mobile UX

**How — manual, DevTools narrow viewport ≤375px (iPhone SE width).**

| Surface | Check | Pass |
|---|---|---|
| `/clients/<id>/summary` | Lead intelligence card width | No horizontal scroll. Sources wrap. |
| Same | Refresh button | Hit area ≥ 44×44. Visible without zoom. |
| Same | Skeleton on cold load | Animates smoothly. No layout shift on content reveal. |
| Same | `prefers-reduced-motion` enabled | Animations freeze. Content still renders. |
| `/dashboard` | Chip placement | Chip doesn't push name truncate awkwardly. |
| Same | Quick actions on the right | Still tappable; chip doesn't crowd them. |
| Any AI page | Card under 100% mobile viewport height | Card doesn't push next-action buttons below fold. |

**Pass:** all rows green. **Fail:** any row red blocks mobile-relevant rollout.

### 3.7 Performance & Perception

Two distinct measurements.

**Real latency** — read from terminal logs:

| Path | Target | Block |
|---|---|---|
| Cold (no cache, primary provider) | ≤4s | >6s consistently |
| Cold (after fallback to secondary) | ≤6s | >10s |
| Warm (cache hit) | ≤300ms | >1s |
| Mutation response (with `after()` prewarm) | unchanged from baseline | +>100ms |

**Perceived latency** — subjective, with anchors:

Open 5 random leads (mix of warm and cold). For each, rate:

- **Instant** — content appears with no wait sensation.
- **Brief** — short skeleton flash, content arrives before attention drifts.
- **Noticeable** — wait is felt, attention drifts, user starts scanning the rest of the page.
- **Broken** — wait feels long enough that the user wonders if something failed.

**Pass:** at least 4/5 leads rated `instant` or `brief`. **Block:** any lead rated `broken`.

The skeleton with rotating Hebrew analysis hints is the perception lever. If perception is bad, the issue is usually a cold cache, not a slow model — fix prewarm coverage, not the model.

### 3.8 Security & Trust

| Concern | Verification | Pass |
|---|---|---|
| Cross-agency leakage | Integration test: authenticate as user from agency B, attempt `getLeadIntelligence(leadFromAgencyA)`. | Returns null / forbidden. Existing `lead-isolation.test.ts` is the pattern. |
| Provider keys in logs | `rg -i "sk-[a-z0-9-]+" terminals/*.txt logs/` | No matches. |
| Provider keys in cached output | Same grep against `.next/cache/`. | No matches. |
| PII in prompts | Read `pruneAndTranslate` output for a lead with full demographics. Confirm shape matches `ai-safety-boundaries.md` §10 expectations. | Only signals intended for the prompt. No SSN/idNum, no full birthdates beyond derived `ageYears`. |
| Hallucinated CRM activity | Editorial rubric §3.4 row "Reference to a date, name, amount, or interaction not in the input." | Zero such references in the 3-lead review. |
| Pretending actions happened | Editorial rubric. | Zero "I added/sent/scheduled" framing. |

---

## 4. AUTOMATED TEST SUITE — SMALL, LONG-TERM

Three new files, all under `__tests__/ai/`. Total target: ~250 lines, runtime under 5 seconds for the pure ones, <30s for the integration one. Uses the existing Vitest + `npm run test:integration` setup — zero new dependencies.

### A. `__tests__/ai/follow-up-rules.test.ts` — Pure

**Why automated:** rule logic is pure, deterministic, and operational decisions depend on it.

**Asserts:**

- Each of the 7 pulse states produced by a representative input.
- `null` (silent) returned for: terminal status, healthy active lead, brand-new lead under 2 days, all-zero edge case.
- Threshold boundaries: `daysInCurrentStatus` exactly 2 vs exactly 3; exactly 14 vs exactly 13; exactly 21 vs exactly 20.
- Priority order: overdue beats due-today; due-today beats no-open-task; etc.

Promotes the ad-hoc smoke test cases I ran during step C into a real test file.

### B. `__tests__/ai/prompt-sanitizer.test.ts` — Pure

**Why automated:** the sanitizer is a defense-in-depth layer for trust. A regression here goes unnoticed in editorial review until it happens on a real customer.

**Asserts on `sanitizeLeadSummary`:**

- Output containing any `BANNED_TOKENS` value gets confidence dropped to `low` and the offending text removed/redacted.
- Duplicate `sources` are deduped.
- Already-clean output passes through unchanged.
- Empty insights array survives.

**Asserts on `pruneAndTranslate`:**

- Null fields are dropped from the output map.
- Zero-count fields are dropped (e.g. `overdueTaskCount: 0` does not appear).
- Boolean-false fields are dropped.
- Internal English keys are translated to the documented Hebrew equivalents.
- Enum values translated via `STAGNATION_HE` and `RISK_HE`.

### C. `__tests__/ai/intelligence-cache.test.ts` — Integration

**Why automated:** cache correctness is the trust-load-bearing piece. Bugs here are silent for 24h.

**Pattern:** mock the router boundary only (`runStructured`). Real DB. Real `unstable_cache`. Mocks for `next/cache` already exist in the existing test setup.

**Asserts:**

- Two consecutive `getLeadIntelligence` calls for the same lead invoke the (mocked) router exactly **once**.
- Bumping `PROMPT_VERSION` (via test hook) busts the cache — third call invokes the router again.
- A router that throws `AiNonCacheableError` does NOT poison the cache; the next call invokes the router again.
- A successful router call followed by `revalidateTag(leadIntelTag(leadId))` causes the next call to re-invoke the router (refresh path).
- Calling `getLeadIntelligence` with a leadId from a different agency returns `null` (cross-tenant guard).

### Keep-alive script (already exists, do not delete)

- `scripts/evaluate-lead-intelligence.ts` — manual editorial eval. Run before any prompt version bump. Outputs are the artifact for review.

### What this suite does NOT cover (intentionally)

- Provider behavior (their problem, not ours)
- Visual snapshots of card layout (manual mobile pass is faster and catches more)
- E2E browser tests for the chip (rule engine is unit-tested; the rest is presentation)
- Model output assertions on real prompts (brittle, regenerates, manual editorial review handles it)

---

## 5. MANUAL QA RUNBOOK — RUN BEFORE EXPANSION

A single sitting of ~25 minutes covers everything below. Each numbered scenario lists the expected log line or UI state.

### M1 — Cold to warm

1. Pick a never-opened lead. Open `/clients/<id>/summary`.
2. Terminal: `[ai] runStructured.start` → `runStructured.ok latencyMs=<n>`.
3. Reload. Terminal: no new `runStructured` line. UI renders <300ms.
4. PASS if: cold ≤6s, warm <300ms, no double-call.

### M2 — Pre-warm on update

1. Open same lead, note timestamp.
2. Change status via UI. Save.
3. Terminal: within 5s, `prewarm.start reason=lead.update leadId=<id>` then `prewarm.ok`.
4. Reload lead summary. Warm hit.
5. Trigger another status change immediately. Terminal: `prewarm.skip reason=cooldown`.
6. PASS if: cooldown logs as expected, mutation latency unchanged.

### M3 — Failure scenarios (~8 min)

For each F1–F6 in §3.3:

1. Apply the simulation.
2. Reload `/clients/<id>/summary`.
3. Verify expected behavior.
4. Restore environment.

### M4 — Refresh rate limit

1. Open a lead with a card present.
2. Click refresh 4 times within 60s.
3. Expected: 3 successful refreshes (each invokes router), 4th shows `נסה שוב בעוד דקה` inline.
4. Terminal: 3 router calls, then a `refresh.rate_limited` log.

### M5 — Dashboard chips

1. Open `/dashboard`.
2. Count chips per bucket. Note label distribution.
3. Apply §3.5 heuristics. Record tally.

### M6 — Mobile

1. DevTools narrow to 375px width.
2. Visit lead summary, dashboard, lead with skeleton (force cold by bumping PROMPT_VERSION).
3. Run §3.6 checklist.

### M7 — Editorial review

1. Run `npx tsx scripts/evaluate-lead-intelligence.ts`.
2. Apply rubric from §3.4 to outputs of three lead profiles.
3. Record pass/fail per rubric row per lead.

---

## 6. PRE-DEPLOY SMOKE CHECKLIST — 5 MINUTES

The minimum pass before any deploy that touches AI code, including doctrine.

- [ ] `npm run build` passes locally
- [ ] `npm run test:integration` passes (after suite from §4 lands)
- [ ] One lead summary cold path tested manually, < 6s
- [ ] Same lead reloaded, cache hit observed in logs
- [ ] One lead status change → `prewarm.start`/`prewarm.ok` observed
- [ ] `/dashboard` renders, no console errors, chips visible
- [ ] If `PROMPT_VERSION` bumped: 3-lead editorial review attached to commit

---

## 7. WHAT NOT TO TEST YET — ANTI-OVERKILL

These are real things to think about eventually. None of them is worth investing in today.

| Don't build now | Why not |
|---|---|
| LLM-as-judge eval pipelines | Manual rubric on 3 leads catches editorial regressions. Volume too low to justify automation. |
| Snapshot tests of AI output | Brittle. Outputs regenerate often. Manual review is more accurate. |
| Visual regression for the card | One card, low change rate. Manual mobile check is faster. |
| E2E Playwright tests for AI surfaces | The cache, rules, and sanitizer are unit-tested. Rendering is server-only and trivially verifiable manually. |
| Mocked SDK-level provider tests | Mock at the **router boundary**, not the SDK. One seam, not three. |
| Cost monitoring infrastructure | Daily cap + structured `usdCost` logs are enough. Build a dashboard when daily volume crosses 500 calls/agency. |
| Load testing | We're under 100 calls/agency/day. Premature. |
| Chaos testing of provider failures | The fallback chain is tested by a single integration test. Anything beyond that is theater. |
| A separate AI staging environment | The feature flag + agency allowlist already give us per-tenant rollout control. |
| Streaming output tests | We don't stream. When we do, write the test then. |
| Per-row dashboard chip Playwright tests | Rule engine is unit-tested. Visual placement is one component. |

---

## 8. EXIT CRITERIA — IS THE AI LAYER TRUSTWORTHY?

Before we expand the AI footprint into the side-copilot/chat surface or any larger AI investment:

| Gate | Requirement |
|---|---|
| §4 automated suite | Lands and passes |
| §3.3 failure scenarios | All six produce calm degradation |
| §3.4 editorial quality | Three-lead rubric all green on prompt v4 (or whatever is current) |
| §3.5 dashboard chips | At least one full session of real-data observation, frequency tally captured |
| §3.6 mobile pass | All rows green at 375px |
| §3.7 perception | 4 of 5 random leads rated `instant` or `brief` |
| §3.8 security | Cross-agency test passes; no secret leakage in any log |

Any failed gate blocks expansion. The fix is to **harden the existing surface**, not to ship past the gate.

---

## 9. WHAT FAILS LOOK LIKE — THE THINGS WE'RE LOOKING FOR

The three highest-risk failure modes today, in order:

1. **Cache poisoning** — a transient model error gets cached and served as the lead's intelligence for 24 hours. Defense: `AiNonCacheableError`. Test coverage: §4-C. Manual: F6.
2. **Editorial regression** — a prompt change reintroduces internal leakage or chatbot phrasing. Defense: 4-layer prompt discipline + sanitizer. Test coverage: §4-B + manual rubric §3.4.
3. **Cross-agency leakage** — a bug allows a lead from agency A to be summarized while authenticated as agency B. Defense: scoped queries + `requireUser`. Test coverage: §3.8 cross-agency test.

Anything else is recoverable. These three are not — they damage trust permanently.

---

## 10. RELATIONSHIP TO OTHER DOCS

- [`ai-evaluation-checklist.md`](./ai-evaluation-checklist.md) — gate per *new feature*. This doc gates *expansion of the surface as a whole*.
- [`ai-safety-boundaries.md`](./ai-safety-boundaries.md) §12 — failure response playbook.
- [`ai-architecture.md`](./ai-architecture.md) §5, §7 — rollout discipline + failure isolation invariants.
- [`ai-editorial-guidelines.md`](./ai-editorial-guidelines.md) — full source of truth for the editorial rubric.

When this doc and any other AI doctrine conflict, the other doctrine wins. This is a verification methodology, not a stance.
