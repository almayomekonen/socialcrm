/**
 * Messenger saved replies against a real Postgres: tenancy, the title
 * constraint, and the mapping into something sendable.
 *
 * Run: npm run test:db -- __tests__/messenger/messengerSavedReplies.db.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
})

import { db } from '@/config/db'
import {
  asContent,
  createMessengerSavedReply,
  deleteMessengerSavedReply,
  getMessengerSavedReply,
  listMessengerSavedReplies,
  updateMessengerSavedReply,
  type SavedReplyInput,
} from '@/db/messengerSavedReplies'
import { validateRichContent } from '@/lib/facebook/messenger/structured'

let agencyA = 0
let agencyB = 0
let userA = 0

const input = (over: Partial<SavedReplyInput> = {}): SavedReplyInput => ({
  title: 'שעות פעילות',
  body: 'א׳-ה׳ 9:00-17:00',
  quickReplies: [],
  buttons: [],
  attachmentUrl: null,
  attachmentType: null,
  ...over,
})

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_sr_a__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_sr_b__' }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  const [u] = await db('users').insert({ firstName: 'S', role: 'ADMIN', agencyId: agencyA }).returning('id')
  userA = Number(u.id)
})

afterEach(async () => {
  await db('messenger_saved_replies').whereIn('agencyId', [agencyA, agencyB]).delete()
})

afterAll(async () => {
  await db('messenger_saved_replies').whereIn('agencyId', [agencyA, agencyB]).delete()
  await db('users').where({ agencyId: agencyA }).delete()
  await db('agencies').whereIn('id', [agencyA, agencyB]).delete()
})

describe('tenancy', () => {
  it('a reply is visible only to its own agency', async () => {
    const created = await createMessengerSavedReply(agencyA, userA, input())
    expect(created).not.toBeNull()

    expect((await listMessengerSavedReplies(agencyA)).map((r) => r.id)).toEqual([created!.id])
    expect(await listMessengerSavedReplies(agencyB)).toEqual([])
    // A guessable bigserial id is not enough to read another tenant's row.
    expect(await getMessengerSavedReply(agencyB, created!.id)).toBeNull()
  })

  it('another agency cannot edit or delete it, even with the right id', async () => {
    const created = await createMessengerSavedReply(agencyA, userA, input())

    expect(await updateMessengerSavedReply(agencyB, created!.id, input({ body: 'נחטף' }))).toBeNull()
    expect(await deleteMessengerSavedReply(agencyB, created!.id)).toBe(false)

    // Untouched.
    const still = await getMessengerSavedReply(agencyA, created!.id)
    expect(still!.body).toBe('א׳-ה׳ 9:00-17:00')
  })

  it('the same title is free to reuse in a different agency', async () => {
    expect(await createMessengerSavedReply(agencyA, userA, input())).not.toBeNull()
    expect(await createMessengerSavedReply(agencyB, userA, input())).not.toBeNull()
  })
})

describe('the title constraint', () => {
  it('rejects a duplicate rather than creating a picker the rep cannot use', async () => {
    expect(await createMessengerSavedReply(agencyA, userA, input())).not.toBeNull()
    expect(await createMessengerSavedReply(agencyA, userA, input())).toBeNull()
  })

  it('ignores case and surrounding whitespace — the same name to the person typing it', async () => {
    await createMessengerSavedReply(agencyA, userA, input({ title: 'Pricing' }))
    expect(await createMessengerSavedReply(agencyA, userA, input({ title: '  pricing  ' }))).toBeNull()
  })

  it('renaming onto an existing title is refused, not thrown', async () => {
    await createMessengerSavedReply(agencyA, userA, input({ title: 'ראשונה' }))
    const second = await createMessengerSavedReply(agencyA, userA, input({ title: 'שנייה' }))
    expect(await updateMessengerSavedReply(agencyA, second!.id, input({ title: 'ראשונה' }))).toBeNull()
    // And the row still exists under its own name.
    expect((await getMessengerSavedReply(agencyA, second!.id))!.title).toBe('שנייה')
  })
})

describe('structure round-trips', () => {
  it('quick replies, buttons and an attachment survive a save and reload', async () => {
    const created = await createMessengerSavedReply(
      agencyA,
      userA,
      input({
        title: 'מחירון',
        quickReplies: [{ title: 'כן', payload: 'YES' }],
        buttons: [],
        attachmentUrl: 'https://example.com/pricing.pdf',
        attachmentType: 'file',
      }),
    )
    const reloaded = await getMessengerSavedReply(agencyA, created!.id)
    expect(reloaded!.quickReplies).toEqual([{ title: 'כן', payload: 'YES' }])
    expect(reloaded!.attachmentUrl).toBe('https://example.com/pricing.pdf')
    expect(reloaded!.attachmentType).toBe('file')
  })

  it('what is stored is always something Meta will accept', async () => {
    const created = await createMessengerSavedReply(
      agencyA,
      userA,
      input({
        quickReplies: [{ title: 'כן', payload: 'YES' }],
        buttons: [{ type: 'web_url', title: 'לאתר', url: 'https://example.com' }],
      }),
    )
    // A stored reply must round-trip into a valid send. This is the guarantee
    // that a snippet saved today cannot fail at Meta tomorrow.
    expect(validateRichContent(asContent(created!))).toEqual({ ok: true })
  })

  it('an empty jsonb column reads as an empty array, never as null', async () => {
    const [row] = await db('messenger_saved_replies')
      .insert({ agencyId: agencyA, title: 'ידני', body: 'x' })
      .returning('id')
    const reply = await getMessengerSavedReply(agencyA, Number(row.id))
    expect(reply!.quickReplies).toEqual([])
    expect(reply!.buttons).toEqual([])
  })

  it('lists alphabetically so the picker is stable between renders', async () => {
    await createMessengerSavedReply(agencyA, userA, input({ title: 'ב' }))
    await createMessengerSavedReply(agencyA, userA, input({ title: 'א' }))
    expect((await listMessengerSavedReplies(agencyA)).map((r) => r.title)).toEqual(['א', 'ב'])
  })
})
