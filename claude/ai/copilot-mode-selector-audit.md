# copilot-mode-selector-audit.md — Routing Correctness & Observability Pass

> Scope: validate the AI Mode Selector added in the Copilot composer (Fast / Smart / Advanced). Verify UI → server → router → provider wire-up, retry semantics, fallback behaviour, vendor-name containment, and behavioural differentiation. **No refactor, no UX redesign** — observability and validation only.

| | |
|---|---|
| Date | 2026-05-11 |
| Environment | Local dev, real provider keys (.env.local), agency 27 |
| Audit script | [`scripts/audit-mode-selector.ts`](../../scripts/audit-mode-selector.ts) (temporary) |
| Trace flag | `AI_TRACE=1` enables `[AI REQUEST]` / `[AI ROUTER]` / `[FALLBACK]` logs |

---

## 1. PASS / FAIL SUMMARY

| # | Goal | Verdict | Evidence |
|---|---|---|---|
| 1 | UI sends correct mode (Fast → fast / Smart → smart / Advanced → advanced) | **PASS** | Composer `submit()` passes typed `modeId: CopilotModeId` directly. No translation layer. |
| 2 | Router maps modes correctly (fast → volume / smart → primary / advanced → heavy) | **PASS** | Pinned by [`__tests__/ai/copilot-modes.test.ts`](../../__tests__/ai/copilot-modes.test.ts) (21 tests, all green). |
| 3 | Each role resolves to the correct provider/model at runtime | **PASS** (routing) · **DEGRADED** (primary down) | Live run confirmed correct chain selection. Anthropic credit depleted forces fallback for `smart`/`advanced` — see §4. |
| 4 | Retry preserves the original mode | **PASS** | `lastAskRef.current.mode` captured at dispatch; `dispatchRetry → dispatchAsk(text, lenses, attachments, mode)` in [CopilotPanel.tsx:127](../../components/copilot/CopilotPanel.tsx#L127). No silent fallback to default. |
| 5 | Fallback fires correctly when a provider breaks | **PASS** | Anthropic-down condition triggered `[FALLBACK]` for `smart` and `advanced` modes during the live run. `fast` had no fallback (Google succeeded first). |
| 6 | No provider/model names leak into the UI | **PASS** | `grep -rni "claude\|gemini\|gpt\|anthropic\|openai\|sonnet\|opus\|haiku"` against `components/copilot/`, `components/ai/`, `lib/copilot/`, `copilotModes.ts` returns **zero hits**. |
| 7 | Behavioural differences are noticeable across modes | **FAIL (current state)** · **PASS in design** | All 3 modes currently resolve to `gemini-2.5-flash-lite` because Anthropic is down. Mode selector has **zero functional differentiation today**. See §5. |
| 8 | Debug logs expose mode/role/provider/model/latency/retries/fallbackUsed | **PASS** | All three tags emit JSON payloads with the required fields when `AI_TRACE=1`. |

---

## 2. WIRE-UP VERIFICATION (Goals 1–4)

End-to-end trace of a single Copilot ask-question dispatch:

| Step | File | Line | Carries `mode` |
|---|---|---|---|
| 1 | Composer `submit()` calls `onSubmit(question, lenses, attachments, modeId)` | [`CopilotComposer.tsx`](../../components/copilot/CopilotComposer.tsx) | 215 | ✓ |
| 2 | Panel `dispatchAsk(text, lenses, attachments, mode)` records into `lastAskRef.current = { text, lenses, attachments, mode }` | [`CopilotPanel.tsx`](../../components/copilot/CopilotPanel.tsx) | 100 | ✓ |
| 3 | Server action call: `await askLeadQuestion(leadId, text, lenses, attachments, mode)` | [`CopilotPanel.tsx`](../../components/copilot/CopilotPanel.tsx) | 107 | ✓ |
| 4 | Action: `const roleOverride = resolveCopilotModeRole(modeRaw)` | [`leadAskQuestion.ts`](../../actions/ai/leadAskQuestion.ts) | 69 | ✓ |
| 5 | Router call: `runStructured({ ..., roleOverride })` | [`leadAskQuestion.ts`](../../actions/ai/leadAskQuestion.ts) | 133 | ✓ |
| 6 | Chain selection: `getProviderChain(opts.roleOverride ?? cfg.role)` | [`router.ts`](../../lib/ai/router.ts) | 84 | ✓ |
| 7 | Retry path: `dispatchRetry → dispatchAsk(last.text, last.lenses, last.attachments, last.mode)` | [`CopilotPanel.tsx`](../../components/copilot/CopilotPanel.tsx) | 127 | ✓ — never falls back to default |

The panel's `lead-change useEffect` clears `lastAskRef.current = null` when the lead changes, so a retry after a navigation cannot fire against a stale lead. Mode itself is **deliberately not** tied to a lead — it's a user preference that persists across leads.

---

## 3. CATALOG MAPPING (Goal 2)

Pinned by tests in [`__tests__/ai/copilot-modes.test.ts`](../../__tests__/ai/copilot-modes.test.ts):

| Mode (UI) | `CopilotModeId` | `ModelRole` | `requiredTier` |
|---|---|---|---|
| מהיר | `fast` | `volume` | (free) |
| חכם (default) | `smart` | `primary` | (free) |
| מתקדם | `advanced` | `heavy` | `pro` |

Provider-chain resolution (from [`providers.ts:77`](../../lib/ai/providers.ts#L77)):

| Role | Resolved chain (deduped by provider) |
|---|---|
| `volume` | google:gemini-2.5-flash-lite → openai:gpt-4.1-mini |
| `primary` | anthropic:claude-sonnet-4-6 → google:gemini-2.5-flash-lite → openai:gpt-4.1-mini |
| `heavy` | anthropic:claude-opus-4-7 → **google:gemini-2.5-flash-lite** → openai:gpt-4.1-mini |

> ⚠ `heavy` chain order is `['heavy', 'primary', 'volume', 'fallback']`. The Sonnet hop (`primary`) is **silently dropped by the provider-dedup `seen` set** because it shares the `anthropic` provider with Opus. So if Opus fails, the chain skips Sonnet and goes straight to Gemini. This is correct behavior for the "skip a known-broken provider" intent, but documented here because it's non-obvious.

---

## 4. FALLBACK BEHAVIOUR (Goal 5) — LIVE EVIDENCE

The audit script fired one prompt per mode against real provider keys with `AI_TRACE=1`. Anthropic is currently down (depleted credit, see Phase-1 audit F24). This naturally exercised the fallback path for `smart` and `advanced`:

```
mode       │ role      │ served-provider  │ served-model                 │ latency   │ fallback
---------- │ --------- │ ---------------- │ ---------------------------- │ --------- │ ---------
fast       │ volume    │ google           │ gemini-2.5-flash-lite        │ 5744ms    │ false
smart      │ primary   │ google           │ gemini-2.5-flash-lite        │ 6828ms    │ true
advanced   │ heavy     │ google           │ gemini-2.5-flash-lite        │ 5232ms    │ true
```

### `[FALLBACK]` for mode=smart (live)

| Field | Value |
|---|---|
| Original provider | `anthropic` |
| Original model | `claude-sonnet-4-6` |
| Failed attempts | 2 (`retryOnSameProvider + 1`) |
| Failure reason (raw) | `Your credit balance is too low to access the Anthropic API.` |
| Failure reason (classified) | `unknown` ⚠ should be `auth`/`quota` — confirms Phase-1 audit **F25** |
| Wasted latency before fallback | ~570ms (326ms + 244ms) |
| Fallback provider | `google` |
| Fallback model | `gemini-2.5-flash-lite` |
| Fallback success latency | 6828ms |
| Total user-perceived latency | ~7,400ms vs. ~3-4s if Anthropic were healthy |

### `[FALLBACK]` for mode=advanced (live)

| Field | Value |
|---|---|
| Original provider | `anthropic` |
| Original model | `claude-opus-4-7` |
| Failed attempts | 2 |
| Wasted latency before fallback | ~493ms |
| Fallback provider | `google` (NOT Anthropic Sonnet — same-provider dedup) |
| Fallback model | `gemini-2.5-flash-lite` |
| Total user-perceived latency | ~5,725ms |

### `[FALLBACK]` was NOT triggered for mode=fast

`fast` resolved on the first hop (Google) and never had to fall back — no `[FALLBACK]` log emitted. Verified by absence in the trace.

---

## 5. BEHAVIOURAL DIFFERENTIATION (Goal 7) — **FAILING IN PRODUCTION**

| Mode | Output tokens | Answer chars | Latency | Effective model |
|---|---|---|---|---|
| Fast | 87 | 97 | 5744ms | gemini-2.5-flash-lite |
| Smart | 90 | 110 | 6828ms | gemini-2.5-flash-lite |
| Advanced | 68 | 68 | 5232ms | gemini-2.5-flash-lite |

**Verdict: the three modes produce indistinguishable behaviour today.** Variance in answer length (68–110 chars) is within noise for the same model. The user-visible differentiation that the picker promises does not exist while Anthropic is down.

When Anthropic is restored, the design intent is:

| Mode | Expected first-hop | Expected price/call (rough) | Expected latency |
|---|---|---|---|
| Fast | Gemini Flash | ~$0.0002 | 4-6s |
| Smart | Sonnet | ~$0.005-0.01 | 3-5s |
| Advanced | Opus | ~$0.03-0.10 | 8-15s |

So the fix is upstream (restore Anthropic) — not in the mode selector. But until then, the chip is selling a promise it can't keep.

---

## 6. VENDOR-NAME CONTAINMENT (Goal 6)

Grep across all UI surfaces for the forbidden vendor strings:

```
$ grep -rni "claude|gemini|gpt|anthropic|openai|sonnet|opus|haiku" \
    components/copilot/  components/ai/  lib/copilot/  lib/ai/copilotModes.ts
(no matches)
```

All vendor IDs live exclusively in:
- [`lib/ai/router.ts`](../../lib/ai/router.ts) (debug logs only — server-side)
- [`lib/ai/providers.ts`](../../lib/ai/providers.ts) (model resolution)
- [`lib/ai/env.ts`](../../lib/ai/env.ts) (env mapping with sane defaults)
- [`lib/ai/healthcheck.ts`](../../lib/ai/healthcheck.ts), [`lib/ai/tasks.ts`](../../lib/ai/tasks.ts) (cost map, healthcheck schema)

None are imported by, referenced by, or shipped to any client component. The `IconNames` type in [`lib/Icon.tsx`](../../lib/Icon.tsx) is the only client import that mentions `bolt`/`brain`/`gem` — those are visual assets, not vendor labels.

→ Doctrine compliance: `ai-safety-boundaries.md` §7 (no model IDs in UI).

---

## 7. DEBUG LOGGING (Goal 8)

Three temporary log tags added, all gated on `AI_TRACE=1`:

| Tag | Location | Fields exposed |
|---|---|---|
| `[AI REQUEST]` | [`leadAskQuestion.ts:75`](../../actions/ai/leadAskQuestion.ts#L75) | `surface`, `mode`, `role`, `leadId`, `agencyId`, `questionChars`, `lensCount`, `attachmentCount` |
| `[AI ROUTER]` | [`router.ts`](../../lib/ai/router.ts) | `kind`, `role`, `provider`, `model`, `attempt`, `latencyMs`, `fallbackUsed`, `success`, `errorCode?`, `message?` (per attempt, success or fail) |
| `[FALLBACK]` | [`router.ts`](../../lib/ai/router.ts) | `kind`, `role`, `from`, `to`, `toModel`, `reason`, `message` (only when chain advances) |

**Required fields per the audit brief:**

| Field | Surfaced? | Where |
|---|---|---|
| mode | ✓ | `[AI REQUEST]` |
| role | ✓ | `[AI REQUEST]`, `[AI ROUTER]`, `[FALLBACK]` |
| provider | ✓ | `[AI ROUTER]`, `[FALLBACK].from`/`.to` |
| model | ✓ | `[AI ROUTER]`, `[FALLBACK].toModel` |
| latency | ✓ | `[AI ROUTER].latencyMs` |
| retries | ✓ | `[AI ROUTER].attempt` (0-indexed; max = `cfg.retryOnSameProvider`) |
| fallbackUsed | ✓ | `[AI ROUTER]` (boolean per call), `[FALLBACK]` (event itself) |

### How to enable / disable

```bash
# Enable (per-process)
AI_TRACE=1 npm run dev

# Single-shot script
AI_TRACE=1 npx tsx scripts/audit-mode-selector.ts

# Disable: omit AI_TRACE entirely (default off in all environments)
```

### How to remove after audit

Search-and-strip is two greppable strings:
```bash
grep -rn "AI_TRACE\|TEMPORARY \[AI" lib/ai/router.ts actions/ai/leadAskQuestion.ts
```
3 blocks total. Each is bracketed by a `// TEMPORARY` comment.

---

## 8. EDGE CASES SURFACED

| # | Edge case | Behaviour | Notes |
|---|---|---|---|
| 1 | User picks `advanced` while Anthropic is down | Chain skips Sonnet (provider-dedup) and falls straight to Google. `[FALLBACK]` fires once. | Confirmed live. The user pays the full Opus retry penalty (~500ms) before serving. |
| 2 | User submits before mode-state hydrates from `localStorage` | Composer initializes `modeId = DEFAULT_COPILOT_MODE_ID = 'smart'`. Hydration `useEffect` runs after mount; if user submits within the same first paint, they get `smart`. | Defensible default — same as today's behaviour. |
| 3 | Invalid mode value sent (e.g. `null`, `'volume'`, `42`) | `resolveCopilotModeRole` falls back to default mode's role. No throw, no leak. | Pinned by 8 unit tests in `copilot-modes.test.ts`. |
| 4 | Retry after lead change | `lead-change useEffect` resets `lastAskRef.current = null`. Retry button has nothing to retry; falls through. | Correct — never re-fires a stale lead's question. |
| 5 | User opens panel mid-request → submits a different mode | Token guard discards the in-flight UI; **server call still completes and bills** (Phase-1 audit F2 — unchanged by this feature). | Worth a dedicated follow-up — the new feature makes this more expensive when the user explores modes. |
| 6 | `AI_TRACE=1` in production | All logs emit JSON to stdout — metadata only, no raw prompts/answers. Doctrine §8 compliant. | Safe to leave on if needed; can be turned off without redeploy via env-var change. |
| 7 | Three modes during one panel session | Mode is composer-local state + `localStorage`. Switching mode does not reset the answer card. | Last answer stays visible until next dispatch — no flicker between mode picks. |

---

## 9. ARCHITECTURAL RISKS

### 9.1 Mode-as-illusion when primary provider is degraded
Today, all three modes resolve to the same fallback model. The selector communicates intent that the system can't deliver. Either:
- Surface a degraded-state hint in the chip (`חכם · במצב חלופי`) — adds UI complexity
- Just restore Anthropic and the contract holds

Recommend the latter.

### 9.2 `errorCode: 'unknown'` for the credit-balance failure
[`router.ts:201-209`](../../lib/ai/router.ts#L201) `classifyError` doesn't recognize "credit balance" / "quota" patterns. Each cold call burns 2 wasted retries against an obviously-permanent failure. With the mode selector, **Smart and Advanced now both pay this penalty** — the audit measured ~570ms and ~493ms wasted respectively. Fixing this is in scope for Phase 1 of the broader audit (F25), not this audit, but worth noting that the mode selector amplifies it.

### 9.3 Provider-dedup may surprise future contributors
[`providers.ts:74-86`](../../lib/ai/providers.ts#L74) silently drops same-provider hops. For `heavy`, that means `[Opus, Sonnet, Gemini, GPT]` becomes `[Opus, Gemini, GPT]`. If someone later adds an "Advanced+" mode pointing at a different Anthropic model, they may expect Sonnet to be a hop and find it isn't. **Not a bug; an undocumented invariant.**

### 9.4 No per-mode cost cap
Daily USD cap ([`router.ts:30-52`](../../lib/ai/router.ts#L30)) is per-agency, not per-mode. A rep clicking `advanced` 50 times in a row could blow the cap entirely on Opus calls while Smart/Fast users at the same agency are starved. **Worth tracking once Anthropic is back.**

### 9.5 Predefined actions don't take the mode override
By design — followup/nextStep are cached per lead; adding mode to the cache key would 3× the cache surface. But a rep who selected `advanced` and clicks "draft followup" will silently get `smart`-tier output. **Consider a UI signal** that mode applies only to ask-question, OR add a small `(mode)` segment to the cache key for these actions.

---

## 10. RECOMMENDATIONS

In priority order:

1. **Restore Anthropic credit.** Until then, mode selector is non-functional in spirit. (External action, not code.)
2. **Fix `classifyError`** to recognize quota/balance failures — short-circuit retries on permanent errors. Drops 500-700ms off every mode-selector cold call. (Phase-1 audit F25.)
3. **Add a unit test for the fallback `[FALLBACK]` emission** by mocking `runStructured` → `generateObject` to fail and asserting the log shape. Currently only verified by live run.
4. **Decide on §9.5** — clarify in UI that mode applies only to ask-question, OR add per-mode cache for predefined actions.
5. **Once §1–§3 are done, re-run this audit** to confirm behavioural differentiation (Goal 7) actually fires.
6. **Remove temporary debug logs** after the audit signs off — `AI_TRACE` blocks are tagged `// TEMPORARY [AI ...]`, easy to grep-and-strip.

---

## 11. WHAT THE NEW UNIT SUITE COVERS

[`__tests__/ai/copilot-modes.test.ts`](../../__tests__/ai/copilot-modes.test.ts) — 21 tests, all pure (no DB, no API):

- Catalog order pinned: `['fast', 'smart', 'advanced']`
- Default mode pinned: `'smart'` (matches today's `lead.askQuestion` behaviour)
- 3× `mode → role` mapping tests
- Hebrew label + non-empty description per mode
- `requiredTier: 'pro'` only on `advanced`
- 3× valid `isCopilotModeId` accept tests
- 9× invalid-input rejection tests
- 4× `resolveCopilotModeRole` fallback-to-default tests
- Catalog round-trip tests

Combined unit suite: **8 files / 180 tests passed / 0 failed** (was 7 / 159 before this audit).

---

## 12. ARTIFACTS

| File | Status | Purpose |
|---|---|---|
| [`__tests__/ai/copilot-modes.test.ts`](../../__tests__/ai/copilot-modes.test.ts) | **Permanent** | Pins mode → role mapping, default, and validation guard. |
| [`scripts/audit-mode-selector.ts`](../../scripts/audit-mode-selector.ts) | **Temporary** | One-shot live audit harness. Delete after sign-off. |
| `[AI REQUEST]` block in [`actions/ai/leadAskQuestion.ts`](../../actions/ai/leadAskQuestion.ts) | **Temporary** (gated `AI_TRACE=1`) | Captures the user-selected mode at action entry. |
| `[AI ROUTER]` / `[FALLBACK]` blocks in [`lib/ai/router.ts`](../../lib/ai/router.ts) | **Temporary** (gated `AI_TRACE=1`) | Per-attempt resolution + chain-advance events. |

All temporary code is tagged `// TEMPORARY [AI ...]` for greppable removal.
