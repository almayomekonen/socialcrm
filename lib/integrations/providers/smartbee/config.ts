import { smartbeeProductionEnabled } from '@/lib/flags/smartbeeFlags'
import type { IntegrationEnvironment } from '@/lib/integrations/core/types'

/**
 * SmartBee endpoints and OUR provider credentials (one clientId/password pair
 * for the whole integration, issued by SmartBee at onboarding). Both are
 * server-side environment variables, never stored in the database and never
 * logged.
 *
 *   SMARTBEE_TEST_CLIENT_ID / SMARTBEE_TEST_CLIENT_PASSWORD  — sandbox
 *   SMARTBEE_PROD_CLIENT_ID / SMARTBEE_PROD_CLIENT_PASSWORD  — production
 *
 * Base URLs are from SmartBee's integration guide (2026-09-28).
 */

export const SMARTBEE_BASE_URLS: Readonly<Record<IntegrationEnvironment, string>> = {
  test: 'https://test.smartbee.co.il/api/v1',
  production: 'https://smartbee.co.il/api/v1',
}

/** The guide recommends at least 30 seconds. */
export const SMARTBEE_TIMEOUT_MS = 30_000

export class SmartbeeConfigError extends Error {
  constructor(public reason: 'production_disabled' | 'missing_credentials') {
    super(`smartbee.config.${reason}`)
    this.name = 'SmartbeeConfigError'
  }
}

export function smartbeeProductionAllowed(): boolean {
  return smartbeeProductionEnabled()
}

/** The base URL, refusing production unless it was explicitly enabled. */
export function smartbeeBaseUrl(env: IntegrationEnvironment): string {
  if (env === 'production' && !smartbeeProductionAllowed()) throw new SmartbeeConfigError('production_disabled')
  return SMARTBEE_BASE_URLS[env]
}

export function smartbeeClientCredentials(env: IntegrationEnvironment): { clientId: string; password: string } {
  const prefix = env === 'production' ? 'SMARTBEE_PROD' : 'SMARTBEE_TEST'
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim()
  const password = process.env[`${prefix}_CLIENT_PASSWORD`]
  if (!clientId || !password) throw new SmartbeeConfigError('missing_credentials')
  return { clientId, password }
}

/** Unique across our whole API client, forever (SmartBee dedups permanently). One per agent action. */
export function smartbeeProviderMsgId(env: IntegrationEnvironment, agentActionId: string): string {
  return `scrm-${env}-${agentActionId}`
}
