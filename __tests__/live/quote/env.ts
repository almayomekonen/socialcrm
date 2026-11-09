import { existsSync } from 'node:fs'
// First on purpose: this module re-reads .env.test with override when it loads, which would undo everything set below.
import '@/config/db'
import { priceFor, maxCacheWriteRate } from '@/lib/ai/usage/pricing'
import { createBudget, effectiveCapUsd, reserveFor, type BudgetState } from './budget'
import { createFakeProvider, type FakeProvider } from './fakeProvider'
import { HarnessRefused, assertSafeToRun, installNetworkGuard, readPrivateEnvFile, scrubSecrets, type NetworkGuard } from './safety'

/**
 * Runs in the test process after the standard setup, before anything reads
 * configuration (the AI config is cached on first read).
 *
 * All flags here exist only inside this process and name two synthetic agencies.
 *
 * self   no key, no network: a scripted provider.
 * model  the real model, using ONLY the dedicated key in .env.quote-live.local.
 *        Never `.env.local`, `.env.production.local` or another worktree.
 */

export const AUTHORIZED_AGENCY = 99701
export const EXEMPT_AGENCY = 99702
export const KEY_FILE = '.env.quote-live.local'
export const HARD_CAP_USD = 8
const OPENAI_HOST = 'api.openai.com'

assertSafeToRun(process.env)

export type LiveContext = { mode: 'self' | 'model'; model: string; repeats: number; capUsd: number; budget: BudgetState; guard: NetworkGuard; fake: FakeProvider | null }

const mode = process.env.QUOTE_LIVE_MODE === 'model' ? 'model' : 'self'
const file = mode === 'model' ? (existsSync(KEY_FILE) ? readPrivateEnvFile(KEY_FILE) : null) : null
if (mode === 'model' && !file?.QUOTE_LIVE_API_KEY) throw new HarnessRefused(`${KEY_FILE} with QUOTE_LIVE_API_KEY is required. No other key source is used.`)

// Self-test spends nothing (a scripted provider), so its figures are simulated and its own cap never ends the run.
const SELF_TEST_CAP_USD = 1000
const capUsd = mode === 'self' ? SELF_TEST_CAP_USD : effectiveCapUsd(Number(file?.QUOTE_LIVE_MAX_USD ?? HARD_CAP_USD), process.env.QUOTE_LIVE_CAP_USD)
if (mode === 'model' && (!(capUsd > 0) || capUsd > HARD_CAP_USD)) throw new HarnessRefused(`the cap must be above 0 and at most ${HARD_CAP_USD}`)
// Named on purpose, never defaulted: the run must use the model Production uses, and that value lives in Vercel, not in this repo.
if (mode === 'model' && !file?.QUOTE_LIVE_MODEL) throw new HarnessRefused(`${KEY_FILE} must name QUOTE_LIVE_MODEL`)
const model = file?.QUOTE_LIVE_MODEL || 'gpt-5.6'
const hit = priceFor(model)
if (!hit) throw new HarnessRefused(`no listed price for ${model}, so the cap cannot be enforced`)

scrubSecrets(process.env, ['JWT_SECRET', 'SECRETS_ENC_KEY', 'MOBILE_JWT_SECRET', 'MCP_JWT_SECRET'])
const ids = `${AUTHORIZED_AGENCY},${EXEMPT_AGENCY}`
Object.assign(process.env, {
  OPENAI_API_KEY: file?.QUOTE_LIVE_API_KEY ?? 'sk-self-test-not-a-real-key',
  AI_PROVIDERS: 'openai',
  AGENT_OPENAI_MODEL: model,
  AI_ENABLED: 'true',
  AI_AGENCY_ALLOWLIST: ids,
  AGENT_AGENCY_IDS: ids,
  AI_DAILY_USD_CAP: '100',
  WA_ASSISTANT_AGENCY_IDS: ids,
  WA_ASSISTANT_QUOTES_AGENCY_IDS: ids,
  WA_ASSISTANT_DAILY_USD_CAP: '100',
  OWNER_WA_REMINDERS_AGENCY_IDS: ids,
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000001',
  PLATFORM_WHATSAPP_ACCESS_TOKEN: 'EAAG_harness_fake_token_not_real',
})

const fake = mode === 'self' ? createFakeProvider() : null
const guard = installNetworkGuard({ allowedHosts: [OPENAI_HOST], inner: fake?.fetch })
const guarded = globalThis.fetch
const price = hit.price
const budget = createBudget({
  inner: guarded,
  capUsd,
  reserveUsd: reserveFor(capUsd),
  // Worst case: uncached input at the highest input rate this model bills.
  price: { inputPerM: Math.max(price.input, maxCacheWriteRate(price) ?? 0), cachedInputPerM: price.cachedInput, outputPerM: price.output },
  defaultMaxOutputTokens: 1200,
})
globalThis.fetch = budget.fetch

;(globalThis as Record<string, unknown>).__quoteLive = {
  mode,
  model,
  repeats: mode === 'self' ? 1 : Math.min(Number(file?.QUOTE_LIVE_REPEATS ?? 1) || 1, 5),
  capUsd,
  budget: budget.state,
  guard,
  fake,
} satisfies LiveContext
