import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { packages } from '@/lib/plans'
import { FREE_LEAD_LIMIT } from '@/lib/quota/constants'

/**
 * THE PRODUCT DOES NOT OFFER A FREE TIER TO FALL BACK TO.
 *
 * The billing page advertised a "Free" plan promising "לידים ללא הגבלה" and
 * "ה-CRM כולו חינמי לתמיד". Verified against what an expired account gets:
 *
 *   · app/(app)/layout.tsx renders WorkspaceTeaser INSTEAD of the workspace and
 *     its children once trialStatus is TRIAL_EXPIRED, so the CRM is never
 *     served to an account without access;
 *   · assertLeadQuota caps the free plan at FREE_LEAD_LIMIT — 50, not unlimited.
 *
 * Both claims were false exactly when the Free plan would have applied.
 * Entitlements and limits are unchanged here; only the claim is gone.
 */

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

describe('the in-app plans surface', () => {
  it('offers no Free tier', () => {
    expect(packages.map((p) => p.id)).toEqual(['pro'])
  })

  it('makes no unlimited-leads claim anywhere in it', () => {
    expect(read('lib/plans.ts')).not.toContain("'לידים ללא הגבלה'")
    expect(packages.flatMap((p) => p.included)).not.toContain('לידים ללא הגבלה')
  })

  it('and the limit that contradicted it is untouched', () => {
    // The fix removes a promise, never a capability.
    expect(FREE_LEAD_LIMIT).toBe(50)
  })

  it('says what actually happens after the trial, only where a trial applies', () => {
    const pkg = read('components/settings/payment/Packages.tsx')
    expect(pkg).toContain("t('settings.payment.packages.trialEnds')") // the copy, in the catalog since Phase E4:
    expect(read('lib/i18n/messages/he/settings/payment.ts')).toContain("trialEnds: 'ללא מנוי פעיל, הגישה למערכת נפסקת בתום תקופת הניסיון.'")
    expect(pkg).toContain('{trialActive && (')
  })

  it('the expired account really is blocked, which is why no Free tier is offered', () => {
    const layout = read('app/(app)/layout.tsx')
    expect(layout).toContain("{trialStatus === 'NEVER_STARTED' || trialExpired ? (")
    expect(layout).toContain('<WorkspaceTeaser />')
  })
})
