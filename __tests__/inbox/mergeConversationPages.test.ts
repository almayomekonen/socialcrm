import { describe, it, expect } from 'vitest'
import { mergeConversationPages } from '@/modules/inbox/mergeConversationPages'
import type { InboxConversationListItem } from '@/modules/inbox/types'

const mk = (id: number, unread = false): InboxConversationListItem => ({ conversationId: id, unread } as InboxConversationListItem)

describe('mergeConversationPages', () => {
  it('keeps first-page order, then appends extra', () => {
    expect(mergeConversationPages([mk(1), mk(2)], [mk(3)]).map((i) => i.conversationId)).toEqual([1, 2, 3])
  })
  it('dedups: a conversation in both keeps the fresh first-page copy', () => {
    const fresh = mk(2, true)
    const stale = mk(2, false)
    const out = mergeConversationPages([mk(1), fresh], [stale, mk(3)])
    expect(out.map((i) => i.conversationId)).toEqual([1, 2, 3])
    expect(out.find((i) => i.conversationId === 2)).toBe(fresh) // fresh wins
  })
  it('empty extra returns first page', () => {
    expect(mergeConversationPages([mk(1)], []).map((i) => i.conversationId)).toEqual([1])
  })
  it('empty first page returns extra', () => {
    expect(mergeConversationPages([], [mk(5)]).map((i) => i.conversationId)).toEqual([5])
  })
})
