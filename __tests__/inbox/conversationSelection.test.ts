import { describe, expect, it } from 'vitest'
import {
  markRowsRead,
  removeSelectedRows,
  restoreRows,
  restoreUnread,
  selectedUnreadIds,
  type ConversationListRow,
} from '@/modules/inbox/mobile/conversationSelection'

const row = (id: number, over: Partial<ConversationListRow> = {}): ConversationListRow => ({
  conversationId: id,
  leadId: id,
  channel: 'whatsapp',
  displayName: `שיחה ${id}`,
  leadName: `שיחה ${id}`,
  leadStatus: 'new',
  lastMessageAt: '2026-08-16T11:00:00.000Z',
  lastInboundAt: '2026-08-16T05:00:00.000Z',
  lastHumanOutboundAt: null,
  lastDirection: 'inbound',
  lastMessagePreview: 'היי',
  unread: false,
  attention: null,
  waitingTitle: null,
  waitingWindowHint: null,
  temperature: null,
  intent: null,
  suggestedAction: null,
  when: 'לפני שעה',
  ...over,
})

describe('conversationSelection helpers', () => {
  it('tracks ids only — selectedUnreadIds does not copy row objects', () => {
    const items = [row(1, { unread: true }), row(2, { unread: false }), row(3, { unread: true })]
    expect(selectedUnreadIds(items, new Set([1, 2, 3]))).toEqual([1, 3])
  })

  it('removes selected rows without mutating the snapshot', () => {
    const items = [row(1), row(2), row(3)]
    const next = removeSelectedRows(items, new Set([2]))
    expect(next.map((r) => r.conversationId)).toEqual([1, 3])
    expect(items).toHaveLength(3)
  })

  it('restores failed deletes to their original positions', () => {
    const snapshot = [row(1), row(2), row(3), row(4)]
    const current = [row(1), row(4)]
    const restored = restoreRows(current, snapshot, new Set([2, 3]))
    expect(restored.map((r) => r.conversationId)).toEqual([1, 2, 3, 4])
  })

  it('marks unread rows read and can restore unread on failure', () => {
    const items = [row(1, { unread: true }), row(2, { unread: true })]
    const read = markRowsRead(items, new Set([1]))
    expect(read[0].unread).toBe(false)
    expect(read[1].unread).toBe(true)
    const rolled = restoreUnread(read, items, new Set([1]))
    expect(rolled[0].unread).toBe(true)
  })
})
