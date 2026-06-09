# ai-architecture.md — AI Code & Infrastructure Doctrine

This doc owns **how AI code is structured**. Output text is owned by editorial; sequencing is owned by the roadmap; trust contracts are owned by safety.

The architecture goal: **the lightest infrastructure that lets AI ship safely at the current product scale, with a clear runway to grow without rewrites.**

---

## 1. ARCHITECTURAL STANCE

### 1.1 SSR-first

AI surfaces are **server components inside Suspense**. They render on the server with cached data and stream to the client only when ready.

- AI is **not** fetched from a `'use client'` component via `fetch`.
- AI is **not** fetched in `useEffect`.
- AI is **not** wrapped in TanStack Query / SWR.

**Why:** SSR keeps secrets on the server, makes caching trivial, removes client-side waterfall, and keeps AI fully optional from the client's perspective.

### 1.2 Avoid client state

The only client island we accept around an AI surface is a **manual refresh button** that calls a server action. That's it.

If you find yourself writing `useState` to hold AI output, you are doing it wrong. Stop.

### 1.3 Lightweight infra first

We do not run:

- Redis
- BullMQ / SQS / Kafka
- Cron / scheduled jobs
- A separate Node worker
- A vector DB (yet)

We **do** run:

- Next.js `unstable_cache` per entity, tagged
- `next/server`'s `after()` for fire-and-forget pre-warming
- In-memory maps for cooldowns and in-flight dedup
- A daily USD cap counted in process memory

This works because AI volume is small (one entity at a time, single tenant per request). When the daily request count exceeds what one Next.js process can handle reasonably — only then do we revisit. Until then, **do not introduce a queue.**

→ See [`lib/ai/prewarm.ts`](../../lib/ai/prewarm.ts), [`lib/ai/scheduleWarm.ts`](../../lib/ai/scheduleWarm.ts).

---

## 2. PROVIDER ABSTRACTION (NON-NEGOTIABLE)

App code never imports a vendor SDK directly. Period.

- ✅ `import { runStructured } from '@/lib/ai/router'`
- ❌ `import Anthropic from '@anthropic-ai/sdk'`
- ❌ `import { generateObject } from 'ai'` (outside `lib/ai/`)

The router owns provider selection, fallback chain, retries, error classification, structured output handling, and logging.

**Default chain:**

1. Anthropic Sonnet (primary)
2. Google Gemini (fallback)
3. OpenAI GPT-4.1-mini (final fallback)

If a model ID changes upstream, **only the router changes**. Callers never know.

→ See [`lib/ai/router.ts`](../../lib/ai/router.ts).

---

## 3. PROMPT STRUCTURE

Every AI feature owns one file under `lib/ai/prompts/<feature>.ts` that exports:

| Export                             | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `PROMPT_VERSION`                   | Integer. Bump on any change that affects output. Used for cache busting.     |
| `<Feature>Schema`                  | Zod schema for structured output. Strict caps (max chars, max items, enums). |
| `<FEATURE>_SYSTEM_PROMPT`          | The system prompt string.                                                    |
| `build<Feature>UserMessage(input)` | Pure function: input → user message. Does pruning + translation.             |
| `sanitize<FeatureOutput>(output)`  | Defensive cleaner. Catches leakage the prompt missed.                        |

**The four-layer defense** (apply for every AI feature):

1. **Prune at the boundary** — strip null/zero/false/empty fields before they reach the prompt.
2. **Translate before prompting** — turn internal English keys/enums into Hebrew operational labels the model can echo safely.
3. **Constrain at the schema** — enums for taxonomy fields, character caps for free text, item caps for arrays.
4. **Sanitize before cache** — scan the model output for any internal terminology that slipped through; drop confidence on pollution.

The defense is **layered**, not redundant. Each layer catches a different failure mode.

→ See [`lib/ai/prompts/leadIntelligence.ts`](../../lib/ai/prompts/leadIntelligence.ts) as the canonical example.

---

## 4. CACHING

### 4.1 Per-entity, tagged

Cache key includes the entity ID. Cache tag includes the entity ID. Invalidation is targeted.

- ✅ `unstable_cache` per lead, tag = `ai-lead-intelligence:${leadId}`
- ❌ One global cache for all leads
- ❌ Untagged caches that can't be invalidated

→ See `cacheByLead` in [`actions/ai/leadIntelligence.ts`](../../actions/ai/leadIntelligence.ts).

### 4.2 Prompt version is part of the cache key

Bumping `PROMPT_VERSION` busts the entire feature's cache. Use this for any prompt or schema change that affects output.

### 4.3 Don't cache failures

Failed AI calls must throw `AiNonCacheableError`. This sentinel is caught by the cache wrapper and prevents `unstable_cache` from persisting the failure.

Without this, one transient model error poisons the cache for 24 hours.

### 4.4 Stale-while-revalidate is acceptable; hard refresh is rare

Mutations on the underlying entity:

1. Trigger background pre-warm via `scheduleLeadIntelWarm` (uses `after()`).
2. Pre-warm respects per-entity cooldown (5 min) and in-flight dedup.
3. The cached entry stays serving until the warm completes; then the next read picks up the fresh value.

Manual `revalidateTag` is reserved for the **explicit "refresh" button**. Mutation handlers do **not** call `revalidateTag` directly.

---

## 5. ROLLOUT DISCIPLINE

Every AI feature lands in this order:

1. **Dark land.** Code merged, feature flag off, no UI surface. Verify build, types, lint.
2. **Single-tenant smoke.** Flag on for one allowlisted agency. Hit the surface once, watch logs.
3. **Single trigger wired.** If pre-warm is involved, wire it to one trigger first (e.g. `updateLead`), not all triggers.
4. **Verify behavior.** Cooldowns fire, dedup works, fallback chain executes, daily cap is respected.
5. **Expand triggers gradually.** One mutation at a time.
6. **Open allowlist.** Only when steps 2–5 are clean.

→ See `AI_ENABLED`, `AI_AGENCY_ALLOWLIST` in env config.

**No "ship to everyone, see what happens" rollouts.** AI failure modes are subtle; they hide in editorial quality, not in stack traces.

---

## 6. COST PROTECTION

Every AI surface enforces, in this order:

1. **Feature flag** (`AI_ENABLED`)
2. **Tenant allowlist** (`AI_AGENCY_ALLOWLIST`)
3. **Daily USD cap per agency** — checked before the call, recorded after
4. **Per-entity cooldown** for pre-warming (5 min minimum)
5. **In-flight dedup** for concurrent identical requests
6. **Manual refresh rate limit** (3/user/lead/hour)
7. **Schema-enforced output caps** so the model can't run away on tokens
8. **Cache** — usually the strongest cost guard in practice

If any of these is missing from a new feature, it does not ship. Period.

---

## 7. FAILURE ISOLATION (HARD INVARIANT)

> **AI must never block, slow, or break a core CRM flow.**

This is not a goal. This is an architectural invariant.

- AI server components must be wrapped in `<Suspense>` with a skeleton fallback.
- AI fetch logic must `try/catch` and return a graceful empty result on error.
- Mutation handlers (`updateLead`, etc.) **schedule** AI work via `after()` — they never **await** it.
- The page must render correctly with `AI_ENABLED=false`.
- The page must render correctly when all providers are down.

If a mutation that worked yesterday breaks because of an AI bug today, the architecture is broken — not the bug. Fix the architecture.

→ See also [`ai-safety-boundaries.md`](./ai-safety-boundaries.md), §6 (graceful failure as a trust contract).

---

## 8. LOGGING

Every AI run logs a structured event with:

- `feature` (e.g. `lead-intelligence`)
- `entityId`
- `provider` and `modelId` actually used
- `attempt` index in the fallback chain
- `latencyMs`
- `tokenIn` / `tokenOut` / `usdCost`
- `outcome` (`ok` / `fallback` / `fail` / `over_quota` / `prompt_pollution_detected`)
- `promptVersion`

**Never log raw prompts or raw outputs at info level.** Raw payloads belong only behind a debug flag, and even then redact PII.

---

## 9. WHAT WE DO NOT BUILD (YET)

These all have a place eventually. None of them have a place now.

- A vector DB or RAG layer
- An evals platform / LLM-as-judge pipelines (we use a simple comparison script: [`scripts/evaluate-lead-intelligence.ts`](../../scripts/evaluate-lead-intelligence.ts))
- An agent loop with tool use
- Real-time streaming via WebSockets
- A queue / worker process
- A model gateway proxy in front of the router
- **Direct vendor/model selection UI** — i.e. a dropdown that names "Claude Sonnet", "GPT-4.1", "Gemini Flash" to the rep. **Capability-oriented mode tiers** (Fast / Smart / Advanced) are explicitly allowed and documented in §10.
- Long-term memory beyond what the database already stores

Premature investment in any of these creates a heavy infra surface that the rest of the product is not ready to support. → see [`ai-roadmap.md`](./ai-roadmap.md).

---

## 10. CAPABILITY-ORIENTED MODE SELECTION

> **The user picks a capability tier. The router picks the model.** That separation is the architecture rule — not a stylistic preference. A future contributor who deletes the mode selector "to simplify" or replaces it with a vendor-named dropdown is breaking the rule, not cleaning up.

The Copilot composer ships a mode picker with three tiers: **Fast / Smart / Advanced**. This is the _only_ sanctioned model-selection surface in the product, and it is intentional. It looks like model selection. It is not. The distinction is structural.

### 10.1 What "capability-oriented" means

The selector exposes operational tiers the rep can reason about: how fast, how thorough. It does not expose the things the rep should never need to know: vendor name, model identifier, version, region, context window, token cost. The router resolves the tier through `ModelRole` (`volume` / `primary` / `heavy`) into a concrete provider/model. Both resolution steps live entirely in `lib/ai/`.

### 10.2 Allowed vs forbidden in UI copy

| ✅ Allowed (operational)    | ❌ Forbidden (vendor/model)          |
| --------------------------- | ------------------------------------ |
| מהיר / Fast                 | Claude Sonnet 4.6                    |
| חכם / Smart                 | GPT-4.1                              |
| מתקדם / Advanced            | Gemini 2.5 Flash                     |
| "תשובה זריזה לשאלות פשוטות" | "Anthropic primary, OpenAI fallback" |
| "ניתוח עמוק לשאלות מורכבות" | "200k context window, 32k output"    |

A label, description, icon, tooltip, error message, or marketing string that mentions a vendor name or model identifier is a **doctrine violation**. Same posture as [`ai-safety-boundaries.md`](./ai-safety-boundaries.md) §7 (never expose internals) — applied to the selection UI specifically.

### 10.3 The seam: `roleOverride`

`runStructured` accepts an optional `roleOverride?: ModelRole` ([`lib/ai/router.ts`](../../lib/ai/router.ts)). When present, it replaces the task's default role for chain selection. Callers never import a vendor SDK to do this. `getProviderChain(role)` ([`lib/ai/providers.ts`](../../lib/ai/providers.ts)) is the only function in the codebase that touches concrete model identifiers.

The mode catalog at [`lib/ai/copilotModes.ts`](../../lib/ai/copilotModes.ts) is the only file that maps a UI tier to a `ModelRole`. Adding a new mode is one entry there plus, if needed, a new `ModelRole` in [`lib/ai/types.ts`](../../lib/ai/types.ts). No call site in any UI component or server action should ever change.

### 10.4 Why this is not "per-user model selection UI" (the thing we still don't build)

The forbidden pattern is a UX where the rep is asked to choose between "GPT-4o", "Claude Sonnet", "Gemini Pro" — a dropdown of vendor names or model identifiers. That UX:

- Leaks the provider mesh into the product surface.
- Locks future model swaps behind a UI migration and a customer-comms exercise.
- Asks the rep to make a decision they have no basis for.
- Couples the rep's mental model to a specific vendor relationship.
- Forces marketing/legal to track which model names are mentioned where.

The capability tier UX does none of those. The rep picks "more thorough" and the router decides what that means today. If we swap Sonnet for an in-house model tomorrow, the UI doesn't change, no copy needs updating, no announcement is required.

### 10.5 Tier gating (forward-compatible)

Each mode entry in [`copilotModes.ts`](../../lib/ai/copilotModes.ts) carries an optional `requiredTier?: 'pro'` field. There is **no enforcement today** — the field is the contract a future `userTier()` helper will read. When plan gating lands, the policy is:

- Locked modes stay visible in the popover (so the upgrade path is discoverable).
- Selection on a locked mode is blocked with a discrete inline hint, **not** a modal.
- The capability label remains stable across tier changes — a user upgrading from free to pro sees "Advanced" become selectable, not "Claude Opus" suddenly appearing.

The vendor reality stays invisible regardless of the user's plan.

### 10.6 Caching interaction

Cached actions (`getLeadIntelligence`, `generateLeadFollowupMessage`, `generateLeadNextBestStep`) are keyed per lead. Threading mode selection through them would require encoding the mode in the cache key, which would multiply cache footprint and undermine the warming model in §4.4. Until a clear product reason emerges, **mode selection applies only to the freeform `askLeadQuestion` action**, which is uncached by design.

If a future cached action needs mode awareness, the cache key has to grow before the UI does. That ordering is the doctrine — not the other way around.

### 10.7 What this section does NOT permit

A future contributor reading this should treat the following as out of bounds without an explicit doctrine update:

- A "Custom model" power-user dropdown alongside the tier selector.
- A debug panel exposing which provider served the last call. (That signal lives in logs per §8, never in the UI.)
- Mode-specific marketing copy that name-drops a vendor ("Powered by Claude").
- A separate model picker per mutation type (followup vs. next-step). One mode selector, one seam.
- Localizing the mode labels into vendor names for a specific tenant ("Enterprise mode" → "Opus mode").
- Surfacing latency / token / cost numbers next to mode choices to "help the rep decide". Tier descriptions are the user-facing signal; numbers belong in admin observability.

Any of those would re-couple the UI to the provider mesh, which is exactly what `ModelRole` exists to prevent.

### 10.8 Why this section exists

The doctrine in §2 (provider abstraction) is the load-bearing rule. §10 is the rule applied to the surface where it's hardest to enforce — the user-facing selection UI. It exists because the path of least resistance is to label the modes after the models that back them, and that path quietly destroys the abstraction. If a contributor finds the mode selector "confusing" or "vague" and is tempted to rename "Smart" to "Sonnet" — they are, in that moment, the failure mode this section was written to catch.

---

## 11. WHEN TO REVISIT THIS DOC

- When a new AI feature genuinely cannot fit the per-entity cache + `after()` model.
- When daily AI volume per process consistently saturates Node's event loop.
- When two unrelated AI features start sharing prompts or schemas (a sign we need a `lib/ai/shared/`).
- When a provider's behavior diverges enough that the router abstraction starts leaking into call sites.

Until any of those happens — keep this architecture exactly as it is.
