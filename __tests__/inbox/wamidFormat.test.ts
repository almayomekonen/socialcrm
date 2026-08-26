import { describe, it, expect } from 'vitest'
import { isCloudApiWamid } from '@/lib/inbox/wamidFormat'

/**
 * Fixtures are real ids observed in production logs / DB on 2026-08-20..26.
 * A wamid is an opaque identifier — no message content is involved.
 */
const CLOUD_API = [
  // outbound, agency 103 (row 2776) — the id from the original investigation
  'wamid.HBgMOTcyNTM1MzE2OTQzFQIAERgUQ0U1NzY2OTdBM0Q3QjgxQ0FGOTkA',
  // inbound, same tenant (marker 15 02 00, direction byte differs)
  'wamid.HBgMOTcyNTM1MzE2OTQzFQIAEhgUM0E4NTNBQzM2NjY4OTZENDU1QTgA',
  'wamid.HBgMOTcyNTI4OTAwMzE1FQIAEhggQUMwMkNFQkVGNjE1OEVCNTNCQkQz',
]

const BUSINESS_APP = [
  // agency 103 — stored as onboarding_type 'cloud_api', yet emits business-app ids
  'wamid.HBgTSUwuMTczOTcyMTM4NDAzNjUwNBUUABEYFDJBRjE5MzdCMzE4NThGOENDRTU3AA==',
  // agency 64 — onboarding_type 'coexistence'
  'wamid.HBgTSUwuMTAxODk3ODM5MTEyNDIzMBUUABEYFDJBODhCMUY0NThFNzU5MjY3NTM4AA==',
  'wamid.HBgTSUwuMTAxODk3ODM5MTEyNDIzMBUUABEYFDJBQkJDQUMxNTc3ODA0MjdGRTU4AA==',
]

describe('isCloudApiWamid', () => {
  it.each(CLOUD_API)('recognises a Cloud API id: %s', (wamid) => {
    expect(isCloudApiWamid(wamid)).toBe(true)
  })

  it.each(BUSINESS_APP)('recognises a WhatsApp Business app id: %s', (wamid) => {
    expect(isCloudApiWamid(wamid)).toBe(false)
  })

  it('tolerates an id without the wamid. prefix', () => {
    expect(isCloudApiWamid('HBgMOTcyNTM1MzE2OTQzFQIAERgUQ0U1NzY2OTdBM0Q3QjgxQ0FGOTkA')).toBe(true)
    expect(isCloudApiWamid('HBgTSUwuMTczOTcyMTM4NDAzNjUwNBUUABEYFDJBRjE5MzdCMzE4NThGOENDRTU3AA==')).toBe(false)
  })

  /**
   * The classification decides whether an unmatched status is WARNED about.
   * Silencing a genuinely lost event is the only failure that costs anything,
   * so everything unrecognisable must fall on the noisy side.
   */
  it.each([null, undefined, '', 'wamid.', 'wamid.!!!not-base64!!!', 'garbage'])(
    'fails toward Cloud API (a warning) for unusable input: %s',
    (input) => {
      expect(isCloudApiWamid(input as string | null | undefined)).toBe(true)
    },
  )
})
