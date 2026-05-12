# ai-evaluation-checklist.md — Release Gate

Run this checklist before any AI-touching change ships behind the feature flag, **and** before any flag-on rollout to a new tenant.

This is a **gate**, not a guideline. If a row fails, the change does not ship until it's fixed.

Each row links to the doc that owns the rule. Don't argue with the checklist — argue with the doc, then update both.

---

## A. EDITORIAL QUALITY → [editorial](./ai-editorial-guidelines.md)

- [ ] Output produces a **conclusion**, not a description, on at least 80% of test leads.
- [ ] No banned phrases anywhere in output (anthropomorphism, first-person, filler, confidence theater). → §4
- [ ] No corporate vocabulary slipping back in (`פייפליין`, `סטגנציה`, `מעורבות`, `סיכון נטישה` as a label). → §3
- [ ] Hebrew tone is operational, not literary, not enterprise. → §1
- [ ] Output respects all character/item caps (summary ≤180, insights ≤2 of ≤120, reason ≤140). → §5
- [ ] Source attribution uses only the fixed Hebrew categories. No internal field names. → §8
- [ ] Sample of three real leads (sparse / working / strong) reviewed side-by-side with the previous prompt version.

---

## B. TRUST → [safety](./ai-safety-boundaries.md)

- [ ] No fabricated CRM activity in output (dates, interactions, amounts, names not in input). → §4
- [ ] No "I did/sent/added/scheduled" framing. → §5
- [ ] Confidence is honest: `low` for sparse, `medium` default, `high` only when multiply-aligned. → §3
- [ ] No internal terminology in user-facing text (field names, enums, nulls, model IDs). Sanitizer log shows zero pollution events on the test set. → §7
- [ ] No emotional speculation about the lead's feelings or intent. → §8
- [ ] User-control invariant holds: every AI suggestion is visible, reversible, explicit, attributed. → §2
- [ ] Failed AI never produces a confident-looking output. → §3, §6

---

## C. LATENCY & PERCEIVED SPEED → [architecture](./ai-architecture.md), [ux](./ai-ux-principles.md)

- [ ] Cold path completes under ~4s on the slowest tested provider.
- [ ] Warm cache hit renders under ~150ms.
- [ ] Mutation triggers `scheduleLeadIntelWarm`; second view within 5 minutes is warm. → architecture §4.4
- [ ] In-flight dedup verified: two near-simultaneous requests for the same entity → only one provider call.
- [ ] Per-entity cooldown verified: rapid mutations don't blow the daily cap. → §6
- [ ] Page renders normally (no layout shift, no error) when AI takes the maximum allowed time.
- [ ] Page renders normally when `AI_ENABLED=false`. → architecture §7

---

## D. UX POLISH → [ux](./ai-ux-principles.md)

- [ ] Skeleton matches final card height; no layout shift at content reveal. → §3
- [ ] Cold-path skeleton shows rotating Hebrew analysis hints, calm motion only. → §3, §5
- [ ] Empty insights array renders as omission, not as an empty bullet list. → §7
- [ ] Confidence is a pill, not a paragraph; visual states are subtle. → §6
- [ ] Refresh button is secondary, rate-limited, never auto-fires. → §8
- [ ] One primary AI surface on the view (refresh button doesn't count). → §2
- [ ] Mobile layout: card sits below identity, above activity; doesn't push next-action below fold. → §10
- [ ] `prefers-reduced-motion` honored — animations freeze, content still renders. → §5
- [ ] Accessibility: `aria-busy`, `role="status"`, sources as a list, RTL native. → §11

---

## E. COST AWARENESS → [architecture](./ai-architecture.md) §6

- [ ] Feature flag wired and respected.
- [ ] Tenant allowlist wired and respected.
- [ ] Daily USD cap enforced **before** the call; cap-exceeded path tested.
- [ ] Per-entity cooldown active (default: 5 min for pre-warm).
- [ ] Manual refresh rate-limited (3/user/entity/hour).
- [ ] Schema enforces output caps (max chars, max items, enums) — not just prompt instructions.
- [ ] Bulk paths (imports, mass updates) deliberately skipped from pre-warm. → roadmap §3
- [ ] Daily cost projection at full rollout has been calculated and is acceptable.

---

## F. RESILIENCE → [architecture](./ai-architecture.md) §7

- [ ] Failed AI throws `AiNonCacheableError`; cache does not persist failure.
- [ ] Provider fallback chain executes in order: Anthropic → Gemini → OpenAI.
- [ ] Fallback chain tested by forcing each provider to fail (env / mock).
- [ ] Mutation handlers never `await` AI work; they `schedule` it via `after()`.
- [ ] AI server components are wrapped in `<Suspense>`; failure renders graceful fallback.
- [ ] Page renders correctly with all providers misconfigured.
- [ ] Manual refresh on an unhealthy provider renders honestly, does not retry forever. → safety §6

---

## G. ABUSE & EDGE CASES → [architecture](./ai-architecture.md), [safety](./ai-safety-boundaries.md)

- [ ] Per-keystroke generation does not exist anywhere (no AI on input change).
- [ ] No way for a non-allowlisted user to trigger an AI call.
- [ ] No way for a request to span tenants (lead from agency A, prompt sees agency B data).
- [ ] Rapid-fire refresh (10 clicks in 5s) → at most one provider call, rest rate-limited cleanly.
- [ ] Adversarial input in lead notes (prompt injection text) does not change the AI's task or output structure.
- [ ] Extremely long lead notes are truncated at the boundary, not at the model.

---

## H. SPARSE-DATA HANDLING → [editorial](./ai-editorial-guidelines.md) §6, [safety](./ai-safety-boundaries.md) §3

- [ ] A lead with only a status and a name produces a short, honest summary with `confidence: low`.
- [ ] Output does **not** mention what's missing ("אין תיעוד...", "לא ידוע...").
- [ ] `keyInsights` is allowed to be empty and renders cleanly.
- [ ] No filler narration to compensate for thin signal.

---

## I. FALLBACK BEHAVIOR

- [ ] If primary provider returns malformed JSON → router falls back, doesn't surface the error.
- [ ] If sanitizer detects pollution → confidence is dropped to `low`, event is logged, output still renders.
- [ ] If all providers fail → no card renders, page is otherwise unaffected.
- [ ] If daily cap is exceeded → no card renders, no error message, no toast.
- [ ] If feature flag is off mid-session → existing rendered cards stay; new requests get nothing.

---

## J. MOBILE EXPERIENCE → [ux](./ai-ux-principles.md) §10

- [ ] Tested on a real phone (or DevTools narrow viewport ≤375px).
- [ ] Card does not require horizontal scroll.
- [ ] Source pills wrap, do not truncate.
- [ ] Refresh button hit area ≥ 44×44.
- [ ] Card does not push the lead's next-action button below fold.

---

## K. THE FINAL TASTE QUESTION

- [ ] Will a real user, between two calls, on their phone, in 10 seconds, **act faster** because of this AI surface?

If you cannot answer "yes" with conviction — the surface is not ready, regardless of how clean every other row in this checklist looks.

→ See [`/claude/CLAUDE.md`](../CLAUDE.md) §8 (decision rule), [`ai-product-philosophy.md`](./ai-product-philosophy.md) §5 (the taste test).

---

## L. POST-RELEASE VERIFICATION (FIRST 48H)

After rollout to any new tenant:

- [ ] Provider distribution looks expected (primary serving most calls).
- [ ] No spike in `prompt_pollution_detected` events.
- [ ] Daily cap usage is below 50% of allowance.
- [ ] No reports of AI-misleading-content support tickets.
- [ ] No `AiNonCacheableError` rate above ~2% per provider.
- [ ] Page latency for the surface (P95) is unchanged from pre-release baseline.

If any row fails, **flip the flag off** and triage. → [`ai-safety-boundaries.md`](./ai-safety-boundaries.md) §12.
