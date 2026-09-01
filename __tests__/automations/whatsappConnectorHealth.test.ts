/**
 * How WhatsApp health maps to automation connection health.
 *
 * Pinned, not changed. The #80008 work introduced a `throttled` primary, which
 * falls through this mapping's `else` to 'degraded' — previously it arrived as
 * `unknown` and mapped to 'needs_reauth'.
 *
 * That relabelling changes NO behaviour: `resolveCapabilities` and
 * `connectionsForCapability` (lib/automations/connectors/resolve.ts) count only
 * `health === 'ok'`, and `isConnectionProblem` is `health !== 'ok'`. 'degraded'
 * and 'needs_reauth' are equally not-ok, so a throttled connection withholds its
 * capability exactly as it did before — no regression, and no accidental
 * loosening of automation eligibility either.
 *
 * The improvement is honesty: a transient rate limit no longer claims the
 * customer must re-authenticate.
 */
import { describe, expect, it } from 'vitest'
import { isConnectionProblem } from '@/lib/automations/connectors/resolve'
import { CONNECTION_HEALTH } from '@/lib/automations/catalog/vocabularies'

describe('automation connection health vocabulary', () => {
  it('degraded is a recognised health value', () => {
    expect(CONNECTION_HEALTH).toContain('degraded')
    expect(CONNECTION_HEALTH).toContain('needs_reauth')
  })

  it('degraded and needs_reauth are BOTH problems — the relabel changes nothing', () => {
    expect(isConnectionProblem('degraded')).toBe(true)
    expect(isConnectionProblem('needs_reauth')).toBe(true)
    expect(isConnectionProblem('ok')).toBe(false)
  })

  it('only ok is not a problem, so throttled cannot silently grant a capability', () => {
    for (const h of CONNECTION_HEALTH) {
      expect(isConnectionProblem(h)).toBe(h !== 'ok')
    }
  })
})
