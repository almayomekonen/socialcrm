/** Which Grow environment a call is made against. */
export type GrowMode = 'sandbox' | 'production'

/**
 * Grow Light API configuration for card-token billing.
 *
 * Server-only. The base URL is derived from GROW_MODE in code, never read from
 * an env var, so a production deployment cannot be pointed at the sandbox (or
 * the reverse) by a typo. Identifiers differ per Grow environment.
 */

export const GROW_SANDBOX_BASE_URL = 'https://sandbox.meshulam.co.il/api/light/server/1.0'
export const GROW_PRODUCTION_BASE_URL = 'https://secure.meshulam.co.il/api/light/server/1.0'

const BASE_URLS: Record<GrowMode, string> = {
  sandbox: GROW_SANDBOX_BASE_URL,
  production: GROW_PRODUCTION_BASE_URL,
}

export type GrowApiConfig = { mode: GrowMode; baseUrl: string; userId: string; tokenPageCode: string }
export type GrowRuntime = { env: 'production' | 'staging'; mode: GrowMode }

function readMode(): GrowMode {
  const mode = process.env.GROW_MODE
  if (mode !== 'sandbox' && mode !== 'production') throw new Error('grow.config.mode_invalid')
  return mode
}

export function getGrowApiConfig(): GrowApiConfig {
  const mode = readMode()
  const userId = process.env.GROW_USER_ID?.trim()
  const tokenPageCode = process.env.GROW_PAGE_CODE_TOKEN?.trim()
  if (!userId) throw new Error('grow.config.user_id_missing')
  if (!tokenPageCode) throw new Error('grow.config.token_page_code_missing')
  return { mode, baseUrl: BASE_URLS[mode], userId, tokenPageCode }
}

/** Vercel's deployment kind. The client-side name is the signal lib/facebook/pixelEnv.ts already trusts. */
function vercelDeployment(): string | undefined {
  return process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV || undefined
}

/**
 * The only runtimes allowed to talk to Grow. Fails closed.
 *
 * REAL MONEY: APP_ENV=production + GROW_MODE=production, and ONLY on the Vercel
 * Production deployment. Preview deployments currently inherit APP_ENV,
 * GROW_MODE and DATABASE_URL from Production (one shared variable record each),
 * so APP_ENV alone cannot tell a preview from production. There is deliberately
 * no override: an escape hatch here is how a preview would charge a customer.
 *
 * SANDBOX: APP_ENV=staging + GROW_MODE=sandbox, never on the Production
 * deployment, and only with GROW_SANDBOX_ISOLATED_DATA=true — an explicit
 * attestation set alongside a branch-scoped, non-production DATABASE_URL (see
 * the spec's isolated-staging section). Without it a sandbox callback could
 * write to production data.
 *
 * Local and test can never call Grow — Grow cannot call them back anyway.
 */
export function assertGrowRuntime(): GrowRuntime {
  const env = process.env.APP_ENV
  const mode = readMode()
  const deployment = vercelDeployment()

  if (env === 'production' && mode === 'production') {
    if (deployment !== 'production') throw new Error('grow.runtime.production_requires_vercel_production')
    return { env, mode }
  }
  if (env === 'staging' && mode === 'sandbox') {
    if (deployment === 'production') throw new Error('grow.runtime.sandbox_on_production_deployment')
    if (process.env.GROW_SANDBOX_ISOLATED_DATA !== 'true') throw new Error('grow.runtime.sandbox_requires_isolated_data')
    return { env, mode }
  }
  throw new Error('grow.runtime.env_mode_mismatch')
}

/** successUrl / cancelUrl / notifyUrl must be public HTTPS (Grow rejects localhost). */
export function publicAppOrigin(): string {
  const host = process.env.APP_HOST?.trim()
  if (!host) throw new Error('grow.config.app_host_missing')
  if (/^(localhost|127\.|0\.0\.0\.0)/.test(host)) throw new Error('grow.config.localhost_not_allowed')
  return `https://${host}`
}

/** New trials require a saved card. Absent ⇒ click-to-start, exactly as before. */
export function isCardRequiredTrialEnabled(): boolean {
  return process.env.CARD_REQUIRED_TRIAL_ENABLED === 'true'
}

/** The cron may charge saved tokens. Absent ⇒ no Grow charge is ever attempted. */
export function areSubscriptionChargesEnabled(): boolean {
  return process.env.SUBSCRIPTION_CHARGES_ENABLED === 'true'
}
