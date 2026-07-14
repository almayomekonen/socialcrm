import { describe, expect, it } from 'vitest'
import {
  isLatestStatusRequest,
  registerStatusRequest,
  resolveStatusChangeOutcome,
  STATUS_UPDATED_ANNOUNCE,
} from '@/components/clients/hooks/leadStatusRequest'

describe('lead status request sequencing (Wave A5)', () => {
  it('registers monotonically increasing per-lead request ids', () => {
    const map = new Map<number, number>()
    expect(registerStatusRequest(map, 10)).toBe(1)
    expect(registerStatusRequest(map, 10)).toBe(2)
    expect(registerStatusRequest(map, 20)).toBe(1)
    expect(map.get(10)).toBe(2)
    expect(map.get(20)).toBe(1)
  })

  it('accepts only the latest request for a lead', () => {
    const map = new Map<number, number>([[7, 3]])
    expect(isLatestStatusRequest(map, 7, 3)).toBe(true)
    expect(isLatestStatusRequest(map, 7, 2)).toBe(false)
    expect(isLatestStatusRequest(map, 7, 4)).toBe(false)
  })

  it('exposes Hebrew status announce copy', () => {
    expect(STATUS_UPDATED_ANNOUNCE).toBe('סטטוס עודכן')
  })

  it('ignores stale responses entirely', () => {
    expect(resolveStatusChangeOutcome({ isLatest: false, err: true, previousTab: 'new' })).toEqual({
      apply: false,
    })
    expect(resolveStatusChangeOutcome({ isLatest: false, err: false, previousTab: 'new' })).toEqual({
      apply: false,
    })
  })

  it('rolls back tab on latest failure', () => {
    expect(resolveStatusChangeOutcome({ isLatest: true, err: true, previousTab: 'new' })).toEqual({
      apply: true,
      kind: 'rollback',
      previousTab: 'new',
    })
  })

  it('succeeds on latest ok response', () => {
    expect(resolveStatusChangeOutcome({ isLatest: true, err: false, previousTab: 'new' })).toEqual({
      apply: true,
      kind: 'success',
    })
  })
})
