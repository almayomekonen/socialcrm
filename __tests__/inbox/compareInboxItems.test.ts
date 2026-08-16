import { describe, it, expect } from 'vitest'
import { compareInboxItems } from '@/modules/inbox/client/compareInboxItems'
import type { InboxConversationListItem } from '@/modules/inbox/types'

const item = (over: Partial<InboxConversationListItem>): InboxConversationListItem => ({
  conversationId: 1,
  leadId: 1,
  channel: 'whatsapp',
  displayName: 'x',
  leadName: null,
  leadStatus: null,
  lastMessageAt: '2026-06-01T00:00:00.000Z',
  lastInboundAt: null,
  lastHumanOutboundAt: null,
  lastDirection: 'inbound',
  lastMessagePreview: null,
  unread: false,
  attention: null,
  waitingTitle: null,
  waitingWindowHint: null,
  temperature: null,
  intent: null,
  suggestedAction: null,
  ...over,
})

const ids = (arr: InboxConversationListItem[], sort: Parameters<typeof compareInboxItems>[0]) =>
  [...arr].sort(compareInboxItems(sort)).map((i) => i.conversationId)

describe('compareInboxItems', () => {
  const older = item({ conversationId: 1, lastMessageAt: '2026-06-01T00:00:00.000Z' })
  const newer = item({ conversationId: 2, lastMessageAt: '2026-06-09T00:00:00.000Z' })

  it('latest → newest first', () => {
    expect(ids([older, newer], 'latest')).toEqual([2, 1])
  })
  it('oldest → oldest first', () => {
    expect(ids([newer, older], 'oldest')).toEqual([1, 2])
  })
  it('unread → unread first, then newest', () => {
    const a = item({ conversationId: 1, unread: false, lastMessageAt: '2026-06-09T00:00:00.000Z' })
    const b = item({ conversationId: 2, unread: true, lastMessageAt: '2026-06-01T00:00:00.000Z' })
    expect(ids([a, b], 'unread')).toEqual([2, 1])
  })
  it('temperature → hot > warm > cold > none', () => {
    const cold = item({ conversationId: 1, temperature: 'cold' })
    const hot = item({ conversationId: 2, temperature: 'hot' })
    const none = item({ conversationId: 3, temperature: null })
    const warm = item({ conversationId: 4, temperature: 'warm' })
    expect(ids([cold, hot, none, warm], 'temperature')).toEqual([2, 4, 1, 3])
  })
  it('intent → ranked by server map (signup highest)', () => {
    const other = item({ conversationId: 1, intent: 'other' })
    const signup = item({ conversationId: 2, intent: 'signup' })
    const pricing = item({ conversationId: 3, intent: 'pricing' })
    expect(ids([other, signup, pricing], 'intent')).toEqual([2, 3, 1])
  })
  it('action → ranked by server map (close_lead highest)', () => {
    const none = item({ conversationId: 1, suggestedAction: 'none' })
    const close = item({ conversationId: 2, suggestedAction: 'close_lead' })
    const followUp = item({ conversationId: 3, suggestedAction: 'follow_up' })
    expect(ids([none, close, followUp], 'action')).toEqual([2, 3, 1])
  })
  it('ties broken by conversationId desc (newest id first)', () => {
    const a = item({ conversationId: 5, lastMessageAt: '2026-06-01T00:00:00.000Z' })
    const b = item({ conversationId: 9, lastMessageAt: '2026-06-01T00:00:00.000Z' })
    expect(ids([a, b], 'latest')).toEqual([9, 5])
  })

  it('latest → empty (no lastMessageAt) after active conversations', () => {
    const empty = item({ conversationId: 99, lastMessageAt: null })
    const older = item({ conversationId: 1, lastMessageAt: '2026-06-01T00:00:00.000Z' })
    const newer = item({ conversationId: 2, lastMessageAt: '2026-06-09T00:00:00.000Z' })
    expect(ids([empty, older, newer], 'latest')).toEqual([2, 1, 99])
  })

  it('oldest → empty (no lastMessageAt) after active conversations', () => {
    const empty = item({ conversationId: 99, lastMessageAt: null })
    const older = item({ conversationId: 1, lastMessageAt: '2026-06-01T00:00:00.000Z' })
    const newer = item({ conversationId: 2, lastMessageAt: '2026-06-09T00:00:00.000Z' })
    expect(ids([empty, newer, older], 'oldest')).toEqual([1, 2, 99])
  })
})
