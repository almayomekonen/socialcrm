# copilot-p0-findings.md — Live P0 Test Results

> Companion to [`copilot-validation-audit.md`](./copilot-validation-audit.md). This file records what was actually observed when executing the highest-severity tests against real Anthropic/Google/OpenAI calls, against real seeded leads, on 2026-05-11. The audit doc is the plan; this is the receipt.

---

## RUN SUMMARY

| | |
|---|---|
| Date | 2026-05-11 |
| Environment | Local dev (`/Users/User/Documents/social-crm`), real provider keys |
| Test agency | id=27 (user `alamayo274@gmail.com`) |
| Leads exercised | 14700 (sparse), 14721 (strong), 14712 (ambiguous) |
| Calls fired | 2 prompt versions × 3 leads × multiple provider attempts |
| Total cost observed | ~$0.003 USD across Google + OpenAI fallbacks |
| Total wall time | ~58 seconds for 6 nominal calls |

---

## CRITICAL FINDINGS

These are NEW findings discovered during live execution that were NOT identified by code review alone. They extend the audit doc's F1–F23 list.

### F24 — Anthropic credit balance is depleted (P0, 🚫 BLOCKING)

**Observation.** Every single Anthropic call during the eval returned:
```
Your credit balance is too low to access the Anthropic API.
Please go to Plans & Billing to upgrade or purchase credits.
```

**Impact.**
- The primary provider in the chain is currently non-functional in dev (and presumably anywhere this key is used).
- The product is silently running on Gemini fallback. Every cold call eats the Anthropic latency budget (4 wasted attempts × ~250ms = ~1s per call) before falling back.
- If this Anthropic key is the same one used in production, the entire production AI surface is degraded right now without any monitoring catching it.
- "Cold call ≤4s on the slowest tested provider" target from the verification plan is being silently violated on every call.

**Severity.** P0 — blocks everything. The audit's editorial Phase 1 and any pricing-related work is invalid until Anthropic is restored.

**Recommended action.** Restore Anthropic credit OR switch the primary provider to Google Sonnet-class. Then re-run this entire P0 suite.

---

### F25 — `classifyError` doesn't recognize quota/balance failures (P0, 🚫)

**Observation.** [`router.ts:201-209`](../../lib/ai/router.ts#L201) maps the credit-balance failure to `errorCode: 'unknown'`. The heuristic checks for `401`, `400`, `5xx` patterns and the substring "rate limit", but the credit-balance error is thrown as a plain HTTP 400 with the message body in `.message`.

**Impact.**
- Permanent failures (depleted balance, revoked key, account suspension) are retried `retryOnSameProvider + 1 = 2` times per provider per call. Pure waste.
- The structured log says `errorCode=unknown` for what is really `auth/quota`. Any future cost dashboard or alerting that filters on `errorCode` will miss this category.
- A circuit-breaker pattern is impossible without correct classification.

**Recommended action.** Extend `classifyError` to detect `credit balance`, `quota`, `insufficient`, `permission_denied`, and the AI SDK error class names. Skip retries on this class. Optionally short-circuit the provider for the rest of the process lifetime.

---

### F26 — No provider circuit-breaker (P1, 🚫)

**Observation.** Per cold call against the depleted Anthropic provider:
```
[ai] router.call.fail provider=anthropic ... attempt=0 ... latencyMs=554
[ai] router.call.fail provider=anthropic ... attempt=0 ... latencyMs=560
[ai] router.call.fail provider=anthropic ... attempt=1 ... latencyMs=244
[ai] router.call.fail provider=anthropic ... attempt=1 ... latencyMs=246
```
Four attempts, ~1.6s wasted, before the chain even reaches Gemini.

**Impact.** Multiplied across cold calls in a process, this adds dead latency to every page that triggers a cold AI fetch. Per-process memory of recent provider health would let the router skip a provider that's been failing for the last N minutes.

**Recommended action.** In-process per-provider failure counter with a cooldown window (e.g. "skip provider X for 5 min after 3 consecutive failures"). Pair with F25.

---

### F27 — Worst-case observed latency: 32 seconds (P0, 🐢)

**Observation.** Lead 14721 v3 prompt run: **31,810ms total**. Breakdown:
- Anthropic 4× attempts: ~1.0s wasted
- Google 1× success at 6.7s
- (For v3 second comparison) Google timeout 8s × 2 + OpenAI timeout 8s + OpenAI success 7.2s = 23s

**Impact.** A single user-facing intel card render took 32 seconds. The verification plan's "P95 latency unchanged" gate is broken catastrophically. With Anthropic down, the experienced floor is 5-7s and the ceiling is 30s+.

**Recommended action.** Until F24/F25/F26 are addressed, this is a moving target. Once Anthropic is back, re-establish baseline with 5+ leads and pin the P95.

---

### F28 — Sparse lead got `confidence: medium`, not `low` (P0, 🪤 trust)

**Observation.** Lead 14700: status=`new`, leadAge=3 days, no tasks, no `lastActivityAt`, no `lastOutcomeType`. Pure sparse signal.

v3 output (Gemini fallback):
```
summary: "ליד חדש, עברו 3 ימים מאז נוצר ולא בוצעה פעילות. המצב מוגדר כפעיל אך הדחיפות במעקב נמוכה."
confidence: medium
```

**Impact.** Editorial guideline §6 and safety §3 are explicit: sparse data → `confidence: low`. The fallback model didn't honor this. Because the sanitizer only catches **token** pollution, not **confidence** miscalibration, this slips through silently to the rep.

**This is the exact failure mode the safety doctrine warns about:** "AI must never display a confident-looking output if the underlying call failed — show nothing, or show an honest empty state."

The Anthropic Sonnet primary may handle this correctly. Gemini Flash Lite as fallback does not.

**Recommended action.** Either (a) add a deterministic post-processor that downgrades confidence when input signal density is below a threshold, OR (b) constrain the fallback model with a stricter system prompt that explicitly rejects `medium`/`high` for sparse cases. Option (a) is more reliable.

---

### F29 — Suggested action contains "or" (P1, 🪤)

**Observation.** Lead 14721 v3 (Gemini fallback):
```
suggestedNextAction.title:
  "תעד עדכון במצב המשימה הפתוחה או קבע שיחה עם הלקוח בתוך 3 ימים"
```
Two actions in one title, joined by "או" (or). The intel system prompt says "פעולה אחת קונקרטית". The next-step prompt explicitly bans this: "אסור להציע שתי פעולות בנשימה אחת ('לתאם שיחה ולשלוח מייל'). פעולה אחת."

**Impact.** Violates the editorial constraint silently. No sanitizer catches it.

**Recommended action.** Add a structural validator: if `suggestedNextAction.title` contains ` או ` or ` ו` (and-conjunctions), demote confidence and log. Or add a Zod refinement.

---

### F30 — Internal enum echo as label (P2, 🪤)

**Observation.** Multiple v3 outputs reused the translated enum value as part of the body:
- Lead 14700: "...הדחיפות במעקב נמוכה" (echoes `inactivityRisk` translation)
- Lead 14712: "...שנמצא במצב טיפול 'פעיל'" (echoes `pipelineStagnation: active` translation in single quotes)

**Impact.** Editorial guideline §3: "אל תחזור על שמות הקטגוריות מהקלט כתווית סיכום סופי. תאר מה קרה." The model is treating the translated label as a literal description rather than synthesizing an observation.

The sanitizer's `BANNED_TOKENS` only catches the **English** field names (`pipelineStagnation`, `daysSinceLastInteraction`, etc.) and English enum values (`stale`, `cold`, `active`). The Hebrew translations (`דועך`, `קר`, `פעיל`) are intentionally NOT in the banned list because they're operational language. But when the model uses them **as labels in quotes**, that's still leakage — just in Hebrew.

**Recommended action.** Hard to catch automatically. Best handled via prompt tightening + manual editorial pass per `ai-verification-plan.md` §3.4.

---

### F31 — Gemini schema-validation failure caused another full-fallback (P1, 🐢)

**Observation.** Lead 14712: `No object generated: response did not match schema.` from Gemini, then full fallback to OpenAI added 5+ seconds.

**Impact.** Confirms that schema-validation failures DO trigger fallback (good — `AiNonCacheableError` semantics work). But the latency cost is real: the user waited extra time for the schema-recovery hop.

**Recommended action.** Acceptable behavior in the safety contract. The latency cost should be tracked in the cost dashboard once it exists (F16).

---

## CONFIRMED FROM CODE REVIEW (no live test required)

These were predicted by the code review; the live run did not contradict them.

| # | Finding (from audit) | Status |
| --- | --- | --- |
| F1 | Composer state survives lead switch | **CONFIRMED by reading [`CopilotPanel.tsx:60-64`](../../components/copilot/CopilotPanel.tsx#L60). Token reset is on panel; composer's local `value`/`lenses`/`attachedFiles` not reset.** |
| F5 | Anthropic system-prompt cache not wired | **CONFIRMED by `grep -rn "anthropicCachedSystem"` — only defined in [`caching.ts`](../../lib/ai/caching.ts), zero importers. Every call re-pays full input tokens.** |
| F8 | Streaming is fake | **CONFIRMED by reading [`CopilotResponseCard.tsx:263-352`](../../components/copilot/CopilotResponseCard.tsx#L263). Comment in source acknowledges "for future streaming: text grows, reveal extends".** |
| F10 | Copilot attachments persist as permanent lead files | **CONFIRMED by reading [`uploadAttachments.ts:62`](../../lib/copilot/uploadAttachments.ts#L62) — `addFiles({ presigned, clientId: leadId })`.** |
| F14 | Copilot is desktop-only | **CONFIRMED by reading [`CopilotShell.tsx:31`](../../components/copilot/CopilotShell.tsx#L31) — `desktop:block` class hides on mobile.** |

---

## TESTS NOT RUN (DEFERRED)

The following P0 tests were planned but skipped this session:

| # | Test | Why skipped |
| --- | --- | --- |
| E1–E9 | Adversarial prompt-injection probes against `askLeadQuestion` | Anthropic depleted (F24); running these only against Gemini Flash gives biased results — Gemini is more compliant with injection by default |
| A4 / F1 (test) | Manual UI test of composer stale-state on lead switch | Bug confirmed via code review; manual test would reproduce but adds no information |
| C12 | Full editorial rubric over 5 leads | Eval ran on 3 leads. Once F24 resolved, run with 5+ leads on Anthropic primary for canonical results |
| J3 | Real-rep acceptance of follow-up drafts | Requires actual reps; cannot be agent-executed |
| G4 / G5 | Concurrency / daily-cap race | Requires controlled load; ad-hoc reproduction is unreliable |

---

## EXISTING TEST SUITE STATUS

```
> pnpm test:unit
Test Files  7 passed | 1 skipped (8)
Tests       159 passed | 12 skipped (171)
Duration    845ms
```

All pure-unit AI tests pass. The 1 skipped file is `intelligence-cache.test.ts`, which is the integration suite requiring `VITEST_NO_DB=0` (real DB).

---

## REVISED PRIORITY ORDER

Given F24's discovery, the audit doc's Phase 1 priority list should be re-ordered:

1. **F24** — restore Anthropic credit (or pivot primary). Until done, all latency / editorial / cost measurements are invalid.
2. **F25 + F26** — quota classification + circuit breaker. These limit blast radius of *any* future provider outage, not just this one.
3. **F28** — sparse-lead confidence calibration. Trust contract violation observed in production-like conditions.
4. **F1** — composer stale-state. Trivial to fix; high blast radius.
5. **F10** — attachment persistence policy. Privacy violation waiting to happen.
6. **F5** — wire `anthropicCachedSystem`. Significant cost win once Anthropic restored.
7. Resume the audit doc's Phase 1 list from item 1 onwards.

---

## ARTIFACTS

- Eval script source: [`scripts/evaluate-lead-intelligence.ts`](../../scripts/evaluate-lead-intelligence.ts)
- Full eval transcript: terminal output captured during this session (not saved to file). To reproduce:
  ```
  npx tsx scripts/evaluate-lead-intelligence.ts
  ```
- Each output line beginning with `[ai]` is a structured log entry from [`logger.ts`](../../lib/ai/logger.ts) and matches the future `ai_requests` table shape.

---

## NEXT STEPS FOR THE OWNER

1. **Immediately:** verify production Anthropic credit status. If the same key is in use there, the surface is degraded.
2. **Today:** apply the F25 classify-error fix and re-run eval. Should drop wall time per call by ~1s.
3. **This week:** address F1 (composer reset on lead change) and F10 (attachment persistence policy decision).
4. **Before paid launch:** re-run this entire eval against Anthropic Sonnet primary, capture P95, and execute the deferred E1–E9 prompt injection probes.
