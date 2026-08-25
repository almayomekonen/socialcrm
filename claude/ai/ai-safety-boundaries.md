# ai-safety-boundaries.md — Trust Contract & Hard Limits

This doc owns the **trust contract between AI and the user**. It is the "never list."

Style of how AI talks is owned by editorial; how AI code is built is owned by architecture; both reference this doc when there's a trust dimension.

---

## 1. THE GUIDING INVARIANT

> **AI assists. AI does not autonomously operate the business.**

The user is always in control of their CRM. AI surfaces information, suggests actions, drafts text. The user clicks. The user decides. The user confirms.

If a feature would let AI mutate, send, schedule, or commit anything **without an explicit user click**, that feature does not ship.

---

## 2. USER-CONTROL INVARIANT

Every AI suggestion must satisfy all four:

1. **Visible** — the user can see what AI is suggesting before it happens.
2. **Reversible** — the user can dismiss with one click; if applied, can be undone.
3. **Explicit** — applying requires a deliberate action, never a hover, scroll, or keystroke.
4. **Attributed** — once applied, the resulting record is marked as AI-suggested and is editable by the user.

If any of these is missing, the feature is not safe.

---

## 3. NEVER FAKE CERTAINTY

The user trusts the AI exactly once. The fastest way to lose that trust is to sound confident about something that isn't true.

- AI must report `confidence: low` when data is sparse, even if a confident-sounding sentence would feel better.
- AI must produce **shorter** output when it knows less, never longer.
- AI must **never** invent a metric, a date, or a percentage.
- AI must **never** display a confident-looking output if the underlying call failed — show nothing, or show an honest empty state. → §6.

→ See [`ai-editorial-guidelines.md`](./ai-editorial-guidelines.md) §7 for the meaning of each confidence level.

---

## 4. NEVER FABRICATE CRM ACTIVITY

The AI must not, under any circumstances, claim that something happened in the CRM unless it actually did.

Forbidden:

- "השיחה עם הליד התקיימה לפני 3 ימים" — when no such interaction is recorded.
- "המשימה הוקצתה לנציג" — when no assignment exists.
- "הליד גילה התעניינות במוצר" — when no note or interaction supports it.
- Any reference to specific people, dates, amounts, or products that are not in the input.

Fabrication of CRM facts is the single most damaging failure mode this product can have. It is **worse** than the AI saying nothing.

The architectural defenses are: pruned-and-translated input (the model only sees real data) + sanitizer + sparse-data prompt rules. → see [`ai-architecture.md`](./ai-architecture.md) §3.

---

## 5. NEVER PRETEND ACTIONS HAPPENED

The AI must never speak as if it did something.

Forbidden:

- "תיזכרתי לזכור את זה." (I'll remember this.)
- "הוספתי משימה ליומן." (I added a task to your calendar.)
- "שלחתי הודעה ללקוח." (I sent a message to the lead.)

The AI **suggests**. The user **acts**. There is no in-between.

This rule applies even when the user _did_ click an "apply" button — the AI does not narrate its own success. The UI shows the result.

---

## 6. NEVER BLOCK OR BREAK CORE FLOWS

If AI fails, slows, or returns nonsense, the page must continue working as if AI did not exist.

This is enforced architecturally (`AiNonCacheableError`, Suspense isolation, fire-and-forget pre-warming) — see [`ai-architecture.md`](./ai-architecture.md) §7. As a trust contract:

- A broken AI card never produces a red error banner on the page.
- A broken AI card never delays the rest of the page.
- A failed AI generation never produces a misleading success state.
- Manual refresh while AI is unhealthy renders honestly: "לא ניתן לרענן כעת" (or no UI at all). It does not retry silently forever.

---

## 7. NEVER EXPOSE INTERNALS

The user must never see:

- Field names from the database or input shape (e.g. `daysSinceLastInteraction`, `pipelineStagnation`)
- Enum values (`stale`, `cold`, `medium`, `high`, `null`, `true`, `false`)
- Model identifiers (`gpt-4.1-mini`, `claude-sonnet-4.6`)
- Provider names (`Anthropic`, `OpenAI`, `Google`)
- Token counts, latency numbers, USD costs
- Cache hit/miss indicators
- The phrase "AI" itself, prominently, except where it is genuinely informative

Internal observability lives in logs and dashboards. Not in the UI.

→ Editorial-side enforcement in [`ai-editorial-guidelines.md`](./ai-editorial-guidelines.md) §4.3.
→ Code-side enforcement in `sanitizeLeadSummary` ([`lib/ai/prompts/leadIntelligence.ts`](../../lib/ai/prompts/leadIntelligence.ts)).

---

## 8. NEVER SPECULATE EMOTIONALLY

The AI does not have insight into the lead's feelings, intentions, or mental state. Pretending otherwise damages trust.

Forbidden:

- "הליד מתעניין מאוד." (The lead is very interested.)
- "נראה שהלקוח מהסס." (It seems the customer is hesitating.)
- "הליד דחוי רגשית." (The lead feels rejected.)
- Any guess about why the lead acted or didn't act.

Allowed (operational, observable):

- "אין תיעוד תגובה אחרי השיחה האחרונה." (No documented response since the last call.)
- "המעקב נחלש בשבועיים האחרונים." (Follow-up has weakened over the last two weeks.)

The distinction: the AI may describe **what is observable in the CRM**. It may not infer **what is happening inside the lead's head**.

---

## 9. NEVER OVERWHELM

AI is a quiet helper, not a presenter.

- One primary AI surface per user view. (Refresh button is not a separate surface.)
- No AI notifications outside surfaces the user already opened, except under §9.1.
- No AI banners across the top of unrelated pages.
- No AI-driven popups or modals.
- No AI badges that escalate visually over time ("urgent!", "important!", color-coded panic).

If AI has nothing to say, it says nothing. An empty insight area is mature, not broken.

→ See [`ai-ux-principles.md`](./ai-ux-principles.md) §3 for surface density rules.

### 9.1 The Vigilance Notification Exception (amendment DA-001)

This is the **only** circumstance in which AI output may reach a user who has not
opened a surface. It narrows the rule above; it does not reverse it. An absolute
prohibition becomes a prohibition with one gate, and every condition of that gate
is deterministic.

**Why the prohibition existed.** It was written when AI output was a per-lead card,
generated on demand from a prompt, with no evidence validation, no admission control,
and no mechanism capable of deciding _not_ to speak. Under those conditions a
notification channel would have been a volume channel: the model would have chosen
both what to say and how loudly. One unnecessary interruption discounts every future
one, and that loss is unrecoverable (`/claude/brand-principles.md` §6.1).

**What changed.** The ratified architecture now supplies the decider that was missing.
Constitution XI.4 makes surfacing a genuinely dropped critical item a **duty**, and
states that escalating one is never "noise"; XI.5 keeps the interruption bar over
everything else. Cognitive Architecture J routes exactly one grounded, reversible
outcome — `Recommend` — to the human, behind a value and taste gate, and AI Runtime
Architecture §3.9 names the effector that carries it. The prohibition was written
against a system that could not tell a dropped ball from a remark. That system no
longer describes what we build.

**Why the exception is necessary.** Without it the duty in XI.4 cannot be discharged.
A dropped ball surfaced only inside a page the user already opened is surfaced only
to a user who was already looking — which is precisely the case where nothing was
dropped. The vigilance duty and the "already opened" rule cannot both hold. The
Constitution is supreme (Article 0.1, 0.3), so this rule yields, explicitly and in
writing rather than silently (Article 0.4).

**The gate.** An AI-originated notification is permitted only when **all thirteen** of
the following hold. If any one fails, the notification is not permitted and the
correct outcome is silence.

1.  The originating signal was **deterministically detected**. No model participated
    in deciding that something happened.
2.  The investigation was **admitted by deterministic policy** — budget, staleness,
    coverage and fairness. No model participates in admission.
3.  Reasoning completed through the **existing Agent runtime**. No second agent loop,
    no second reasoning path.
4.  Every surfaced claim passed the **existing evidence validation**, with
    class-specific evidence membership unchanged.
5.  **Subject anchoring** is satisfied: at least one surviving citation is an entity
    belonging to the subject the notification is about.
6.  The **deterministic Tool/Action Gate** accepted the conclusion, and its ordered
    decision trace is recorded.
7.  The **deterministic value/taste bar** accepted it (Cognitive Architecture J
    Gate 2; Constitution XIII).
8.  The model set **no urgency, severity, priority, or delivery decision**. These are
    not model-writable fields. The model's judgement may only ever _reduce_ what is
    surfaced; it may never authorize it.
9.  Delivery went through the **existing notification lifecycle** — the same registry,
    recipient rules, collapse keys and channel policy every other notification uses.
    No parallel delivery path.
10. The notification remains **subject/entity-addressed**: it deep-links to the ליד,
    never to an AI artefact, and it creates no new AI surface.
11. The system remained **read-only** — no CRM write, no autonomous send, no belief
    written back into the world model.
12. **Silence remained the default.** Producing nothing is the expected outcome and
    must cost nothing extra.
13. The notification **does not duplicate a fact an existing deterministic
    notification type already owns and delivers**. Where the same business fact is
    already owned by deterministic notification infrastructure, deterministic
    delivery wins and the AI stays silent. AI may surface only a materially new,
    evidence-grounded conclusion that the existing deterministic notification could
    not have delivered on its own. (One owner per live signal —
    `/claude/brand-principles.md` §6.3.)

**What remains prohibited — unchanged by this amendment.**

- Every other bullet of §9. No AI banners, no AI-driven popups or modals, no
  escalating AI badges, and still one primary AI surface per user view.
- AI-driven notification of anything that is not a gated `Recommend` — summaries,
  digests, tips, product education, engagement, usage reminders, and anything whose
  purpose serves the system rather than the user (`/claude/care-charter.md` Law 12;
  `/claude/brand-principles.md` §6.4).
- A model deciding _whether_ to notify. It may decline. It may never authorize.
- A new AI page, dock, tab, feed, or notification centre
  ([`ai-ux-principles.md`](./ai-ux-principles.md) §1).
- §1 in full: AI still mutates, sends, schedules and commits nothing without an
  explicit user click. A notification is a surfacing, not an action.
- §13 in full: an AI surface that could mislead the user about the state of their
  business is still not safe enough to ship.

This exception is **not a general permission for AI-driven notifications** and must
never be cited as one. It authorizes a single path, gated thirteen ways, whose only
purpose is to discharge a constitutional duty the previous wording made impossible.

---

## 10. PRIVACY POSTURE

- Lead data is tenant-scoped. Prompts must never include data from outside the requesting agency.
- Raw prompt payloads and raw model outputs are **not** logged at info level.
- Provider configuration ensures vendor data-retention is set to the minimum allowed (e.g. Anthropic data residency / no training on inputs).
- If a future AI feature ever requires sending data outside the EU/IL boundary, the contract is: legal review first, feature implementation second. Not the other way around.

---

## 11. AI HEALTH IS A USER-FACING CONTRACT

The user does not need to know the AI is unhealthy — the page must just work. But:

- If AI is intentionally disabled (flag off, agency not allowlisted), the surface is silently absent, **not** replaced with a placeholder begging for upgrade.
- If AI returns no insights but the rest of the call succeeded, the surface renders the empty state honestly.
- If AI returns a result, then the user refreshes, and AI fails — the previous result stays visible. We do **not** flicker to an empty state on every transient failure.

---

## 12. WHEN A SAFETY RULE IS VIOLATED

If a violation reaches production:

1. **Disable the feature flag immediately.** Do not wait for a fix.
2. Reproduce on the offending input. Capture the prompt version, provider, model.
3. Add a layer to the four-layer defense (prune / translate / schema / sanitize) that would have caught the failure. Not just a prompt tweak.
4. Bump `PROMPT_VERSION` so the cache is busted on rollout.
5. Re-enable the flag only after the eval script ([`scripts/evaluate-lead-intelligence.ts`](../../scripts/evaluate-lead-intelligence.ts)) shows the offending case is fixed.

A prompt-only fix to a safety violation is not enough. Safety failures get architectural fixes.

---

## 13. THE GOLDEN SAFETY RULE

> **If an AI surface could mislead the user about the state of their business — it is not safe enough to ship.**

No exceptions. Editorial polish does not override this. Speed does not override this. Cost pressure does not override this.

→ Companion: [`/claude/do-not-touch.md`](../do-not-touch.md) §7 (the project's golden rule for protected systems). Same posture, applied to AI.

---

## 14. AMENDMENT HISTORY

Append-only. This doc sits below the ratified stack and carries no version of its
own; amendments are recorded here so a change to a trust rule can never be silent
(Constitution Article 0.4, 0.6).

### DA-001 — The Vigilance Notification Exception (2026-08-25)

- **Motivation.** Phase 4 (autonomous investigation) must deliver a deterministically
  gated `Recommend` to a נציג who is not currently looking at a surface. Constitution
  XI.4 makes that a duty; §9 forbade it absolutely.
- **What changed.** §9 bullet 2 gains an exception pointer. New §9.1 defines the
  exception, its thirteen conditions, and what stays prohibited.
- **Why the previous doctrine became insufficient.** It was written for on-demand
  prompt output with no evidence validation, no admission control, and no ability to
  decide not to speak. The ratified stack now supplies a deterministic decider, so a
  blanket prohibition no longer matches the system it governs.
- **Scope.** A narrowing, not a reversal: one path, thirteen conditions, silence by
  default. Companion edits: `ai-roadmap.md` §9, `ai-product-philosophy.md` §2.3.
  **No ratified document was modified**, and no code or test changed.
