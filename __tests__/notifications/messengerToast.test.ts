/**
 * Messenger toasts. Awareness (legacy) polls the WhatsApp inbox only and owns its
 * toasts, so registry toasts for the `messages` category stay suppressed — except
 * Messenger, which nothing else would ever toast. Runs without a database.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isToastEligible } from '@/lib/notifications/toastEligibility'
import {
  AWARENESS_OWNED_CATEGORIES,
  MESSAGE_TYPES_TOASTED_BY_REGISTRY,
  selectToastable,
} from '@/modules/notifications/surface'
import type { NotificationFeedItem } from '@/modules/notifications/types'

const CONV = 7
const item = (over: Partial<NotificationFeedItem> = {}): NotificationFeedItem => ({
  id: 1,
  type: 'message.messenger_inbound',
  category: 'messages',
  priority: 'high',
  title: 'הודעה חדשה ב-Messenger',
  body: null,
  entityType: 'messenger_conversation',
  entityId: CONV,
  deepLink: `/inbox/messenger?c=${CONV}`,
  groupCount: 1,
  createdAt: '2026-09-15T09:00:30.000Z',
  seenAt: null,
  readAt: null,
  toastEligible: true,
  ...over,
})
const whatsapp = item({ id: 2, type: 'message.inbound', entityType: 'conversation', deepLink: `/inbox?conversation=${CONV}` })

const select = (items: NotificationFeedItem[], currentPath = '/dashboard') =>
  selectToastable({
    items,
    mountedAt: '2026-09-15T09:00:00.000Z',
    alreadyToasted: new Set(),
    suppressedCategories: AWARENESS_OWNED_CATEGORIES,
    exemptTypes: MESSAGE_TYPES_TOASTED_BY_REGISTRY,
    currentPath,
  })

describe('server eligibility', () => {
  it('a Messenger arrival is toast-eligible while online, like a WhatsApp arrival, and not while away', () => {
    expect(isToastEligible({ type: 'message.messenger_inbound', priority: 'high', presence: 'online' })).toBe(true)
    expect(isToastEligible({ type: 'message.inbound', priority: 'high', presence: 'online' })).toBe(true)
    expect(isToastEligible({ type: 'message.messenger_inbound', priority: 'high', presence: 'offline' })).toBe(false)
  })
})

describe('client selection', () => {
  it('a Messenger arrival toasts; a WhatsApp arrival stays with Awareness (never two toasts)', () => {
    expect(select([item(), whatsapp]).map((i) => i.id)).toEqual([1])
  })

  it('no toast while the rep is already in the Messenger tab, which shows the arrival itself', () => {
    expect(select([item()], '/inbox/messenger')).toEqual([])
    expect(select([item()], '/clients/42/summary').map((i) => i.id)).toEqual([1])
  })

  it('the exemption changes nothing else: seen, backlog and ineligible rows stay silent', () => {
    expect(select([item({ seenAt: '2026-09-15T09:00:31.000Z' })])).toEqual([])
    expect(select([item({ createdAt: '2026-09-15T08:59:00.000Z' })])).toEqual([])
    expect(select([item({ toastEligible: false })])).toEqual([])
  })

  it('the live provider actually passes the exemption and the current page', () => {
    const src = readFileSync(join(process.cwd(), 'modules/notifications/NotificationContext.tsx'), 'utf8')
    expect(src).toContain('exemptTypes: MESSAGE_TYPES_TOASTED_BY_REGISTRY')
    expect(src).toContain('currentPath: window.location.pathname')
  })
})
