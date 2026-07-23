import { describe, it, expect } from 'vitest'
import { canTransition, isWhatsappStatusEvent, statusRank } from '@/lib/inbox/messageStatus'

describe('statusRank', () => {
  it('read and failed share the top rank (both terminal)', () => {
    expect(statusRank('sent')).toBe(1)
    expect(statusRank('delivered')).toBe(2)
    expect(statusRank('read')).toBe(3)
    expect(statusRank('failed')).toBe(3)
  })
})

describe('isWhatsappStatusEvent', () => {
  it('accepts the four Meta status values', () => {
    expect(isWhatsappStatusEvent('sent')).toBe(true)
    expect(isWhatsappStatusEvent('delivered')).toBe(true)
    expect(isWhatsappStatusEvent('read')).toBe(true)
    expect(isWhatsappStatusEvent('failed')).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isWhatsappStatusEvent('received')).toBe(false)
    expect(isWhatsappStatusEvent('deleted')).toBe(false)
    expect(isWhatsappStatusEvent(undefined)).toBe(false)
    expect(isWhatsappStatusEvent(null)).toBe(false)
    expect(isWhatsappStatusEvent(3)).toBe(false)
  })
})

describe('canTransition — forward moves', () => {
  it('sent advances to delivered, read, failed', () => {
    expect(canTransition('sent', 'delivered')).toBe(true)
    expect(canTransition('sent', 'read')).toBe(true)
    expect(canTransition('sent', 'failed')).toBe(true)
  })
  it('delivered advances to read and failed', () => {
    expect(canTransition('delivered', 'read')).toBe(true)
    expect(canTransition('delivered', 'failed')).toBe(true)
  })
})

describe('canTransition — duplicates and out-of-order', () => {
  it('rejects a repeat of the current status', () => {
    expect(canTransition('sent', 'sent')).toBe(false)
    expect(canTransition('delivered', 'delivered')).toBe(false)
  })
  it('rejects a backwards move (late sent after delivered)', () => {
    expect(canTransition('delivered', 'sent')).toBe(false)
  })
})

describe('canTransition — terminal states', () => {
  it('read is terminal: a read message can never become failed', () => {
    expect(canTransition('read', 'failed')).toBe(false)
    expect(canTransition('read', 'delivered')).toBe(false)
    expect(canTransition('read', 'sent')).toBe(false)
    expect(canTransition('read', 'read')).toBe(false)
  })
  it('failed is terminal: a failed message can never become read', () => {
    expect(canTransition('failed', 'read')).toBe(false)
    expect(canTransition('failed', 'delivered')).toBe(false)
    expect(canTransition('failed', 'sent')).toBe(false)
    expect(canTransition('failed', 'failed')).toBe(false)
  })
  it('inbound rows never transition', () => {
    expect(canTransition('received', 'delivered')).toBe(false)
    expect(canTransition('received', 'read')).toBe(false)
    expect(canTransition('received', 'failed')).toBe(false)
  })
})
