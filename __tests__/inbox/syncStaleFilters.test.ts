import { describe, expect, it } from 'vitest'
import { shouldApplySyncResponse } from '@/modules/inbox/client/syncRequestGuard'

describe('inbox sync stale filter drop (Wave A1)', () => {
  it('applies response when filters unchanged', () => {
    expect(shouldApplySyncResponse('{"q":""}', '{"q":""}')).toBe(true)
  })

  it('drops response when filters changed mid-flight', () => {
    expect(shouldApplySyncResponse('{"q":""}', '{"q":"dana"}')).toBe(false)
  })
})
