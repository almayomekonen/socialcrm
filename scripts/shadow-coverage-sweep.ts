/**
 * shadow-coverage-sweep.ts — run the Coverage Sweep (Integration-3) by hand.
 *
 * This invokes the exact same runtime function every scheduler calls, with no
 * HTTP and no scheduler involved — proving the sweep is scheduler-agnostic. Use
 * it in local development to drive continuous cognition manually.
 *
 *   Env-flag driven (same as production):   tsx scripts/shadow-coverage-sweep.ts
 *   Explicit agencies (bypass the flag):     tsx scripts/shadow-coverage-sweep.ts 122,7
 *
 * Reads DATABASE_URL from the local env; writes only to the isolated
 * ai_shadow_coverage table.
 */
import { runShadowCoverageSweep } from '../lib/ai/integration/shadowCoverageSweep'

async function main(): Promise<void> {
  const arg = process.argv[2]
  const agencyIds = arg
    ? arg
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    : undefined

  const summary = await runShadowCoverageSweep(agencyIds ? { agencyIds } : {})
  console.log('[shadow-coverage] summary:', JSON.stringify(summary, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[shadow-coverage] failed:', e)
    process.exit(1)
  })
