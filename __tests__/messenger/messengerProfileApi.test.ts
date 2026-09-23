/**
 * Messenger entry points: what is read from Meta, and exactly what is sent back.
 *
 * These are pure, so the wire shape is pinned without spending one of Meta's
 * ten messenger_profile calls per ten minutes.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_MESSENGER_PROFILE,
  GREETING_MAX,
  getMessengerProfile,
  MENU_MAX_ITEMS,
  MENU_TITLE_MAX,
  messengerProfileBody,
  messengerProfileFieldsToDelete,
  parseMessengerProfile,
  saveMessengerProfile,
  type MessengerProfileConfig,
} from '@/lib/facebook/messenger/messengerProfileApi'
import { validateMessengerProfile } from '@/modules/messenger/profileActions'

const config = (over: Partial<MessengerProfileConfig> = {}): MessengerProfileConfig => ({
  ...EMPTY_MESSENGER_PROFILE,
  ...over,
})

describe('reading a Page profile', () => {
  it('an unset profile reads as empty, not as an error', () => {
    expect(parseMessengerProfile({ data: [] })).toEqual(EMPTY_MESSENGER_PROFILE)
    expect(parseMessengerProfile(null)).toEqual(EMPTY_MESSENGER_PROFILE)
    expect(parseMessengerProfile({})).toEqual(EMPTY_MESSENGER_PROFILE)
  })

  it('reads the default-locale greeting and menu', () => {
    const profile = parseMessengerProfile({
      data: [
        {
          get_started: { payload: 'GET_STARTED' },
          greeting: [
            { locale: 'en_US', text: 'Hi there' },
            { locale: 'default', text: 'היי!' },
          ],
          persistent_menu: [
            {
              locale: 'default',
              composer_input_disabled: false,
              call_to_actions: [{ type: 'postback', title: 'הצעת מחיר', payload: 'QUOTE' }],
            },
          ],
        },
      ],
    })
    expect(profile.greeting).toBe('היי!')
    expect(profile.menuItems).toEqual([{ type: 'postback', title: 'הצעת מחיר', payload: 'QUOTE' }])
    expect(profile.composerInputDisabled).toBe(false)
  })

  it('drops web_url menu items rather than silently converting them to postbacks', () => {
    const profile = parseMessengerProfile({
      data: [
        {
          persistent_menu: [
            {
              locale: 'default',
              call_to_actions: [
                { type: 'web_url', title: 'האתר שלנו', url: 'https://example.com' },
                { type: 'postback', title: 'דברו איתי', payload: 'TALK' },
              ],
            },
          ],
        },
      ],
    })
    // Keeping it would mean re-sending it as a postback on the next save,
    // quietly breaking a link the business set up in Meta's own tools.
    expect(profile.menuItems).toEqual([{ type: 'postback', title: 'דברו איתי', payload: 'TALK' }])
  })

  it('ignores a non-default locale menu rather than presenting it as the default one', () => {
    const profile = parseMessengerProfile({
      data: [{ persistent_menu: [{ locale: 'en_US', call_to_actions: [{ type: 'postback', title: 'Quote' }] }] }],
    })
    expect(profile.menuItems).toEqual([])
  })
})

describe('what is sent to Meta', () => {
  it('always sends Get Started — a persistent menu is refused without one', () => {
    expect(messengerProfileBody(config()).get_started).toEqual({ payload: 'GET_STARTED' })
  })

  it('omits the menu entirely when empty; Meta rejects an empty call_to_actions', () => {
    const body = messengerProfileBody(config({ menuItems: [] }))
    expect(body).not.toHaveProperty('persistent_menu')
  })

  it('omits the greeting when blank rather than sending an empty string', () => {
    expect(messengerProfileBody(config({ greeting: '   ' }))).not.toHaveProperty('greeting')
  })

  it('caps the greeting and menu titles at Meta\'s limits', () => {
    const body = messengerProfileBody(
      config({
        greeting: 'א'.repeat(GREETING_MAX + 50),
        menuItems: [{ type: 'postback', title: 'ב'.repeat(MENU_TITLE_MAX + 20), payload: 'P' }],
      }),
    )
    expect((body.greeting as { text: string }[])[0].text).toHaveLength(GREETING_MAX)
    const menu = body.persistent_menu as { call_to_actions: { title: string }[] }[]
    expect(menu[0].call_to_actions[0].title).toHaveLength(MENU_TITLE_MAX)
  })

  it('sends at most the documented number of menu items', () => {
    const many = Array.from({ length: MENU_MAX_ITEMS + 3 }, (_, i) => ({
      type: 'postback' as const,
      title: `פריט ${i}`,
      payload: `P${i}`,
    }))
    const menu = messengerProfileBody(config({ menuItems: many })).persistent_menu as {
      call_to_actions: unknown[]
    }[]
    expect(menu[0].call_to_actions).toHaveLength(MENU_MAX_ITEMS)
  })

  it('falls back to the title when an item has no payload, never to an empty one', () => {
    const menu = messengerProfileBody(
      config({ menuItems: [{ type: 'postback', title: 'דברו איתי', payload: '' }] }),
    ).persistent_menu as { call_to_actions: { payload: string }[] }[]
    expect(menu[0].call_to_actions[0].payload).toBe('דברו איתי')
  })

  it('leaves the composer enabled by default so a customer can always type', () => {
    const menu = messengerProfileBody(config({ menuItems: [{ type: 'postback', title: 'א', payload: 'A' }] }))
      .persistent_menu as { composer_input_disabled: boolean }[]
    expect(menu[0].composer_input_disabled).toBe(false)
  })
})

describe('clearing fields', () => {
  it('names exactly the fields the new config no longer has', () => {
    expect(messengerProfileFieldsToDelete(config())).toEqual(['greeting', 'persistent_menu'])
    expect(
      messengerProfileFieldsToDelete(
        config({ greeting: 'היי', menuItems: [{ type: 'postback', title: 'א', payload: 'A' }] }),
      ),
    ).toEqual([])
  })

  it('DELETEs before POSTing, so an emptied greeting does not survive the merge', async () => {
    const calls: { method: string; body: unknown }[] = []
    const impl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET', body: JSON.parse(String(init.body)) })
      return { ok: true, status: 200, json: async () => ({ result: 'success' }) } as unknown as Response
    }) as unknown as typeof fetch

    await saveMessengerProfile({ pageId: 'P1', pageAccessToken: 'T', config: config(), fetchImpl: impl })

    expect(calls.map((c) => c.method)).toEqual(['DELETE', 'POST'])
    expect(calls[0].body).toEqual({ fields: ['greeting', 'persistent_menu'] })
  })

  it('a Graph refusal on DELETE is not fatal — the field was simply never set', async () => {
    let call = 0
    const impl = vi.fn(async () => {
      call++
      return call === 1
        ? ({ ok: false, status: 400, json: async () => ({ error: { code: 100 } }) } as unknown as Response)
        : ({ ok: true, status: 200, json: async () => ({ result: 'success' }) } as unknown as Response)
    }) as unknown as typeof fetch

    const result = await saveMessengerProfile({ pageId: 'P1', pageAccessToken: 'T', config: config(), fetchImpl: impl })
    expect(result).toEqual({ saved: true })
  })

  it('a Meta failure on the POST is returned, never thrown', async () => {
    const impl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 10 } }),
    })) as unknown as typeof fetch
    const result = await saveMessengerProfile({
      pageId: 'P1',
      pageAccessToken: 'T',
      config: config({ greeting: 'היי', menuItems: [{ type: 'postback', title: 'א', payload: 'A' }] }),
      fetchImpl: impl,
    })
    expect(result).toMatchObject({ error: { kind: 'graph', code: 10 } })
  })

  it('a read failure is a typed error, not an empty profile that would overwrite live settings', async () => {
    const impl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 190 } }),
    })) as unknown as typeof fetch
    const result = await getMessengerProfile({ pageId: 'P1', pageAccessToken: 'T', fetchImpl: impl })
    expect(result).toMatchObject({ error: { code: 190 } })
    expect(result).not.toHaveProperty('profile')
  })
})

describe('validation', () => {
  it('accepts an ordinary configuration', () => {
    expect(
      validateMessengerProfile(config({ greeting: 'היי', menuItems: [{ type: 'postback', title: 'א', payload: 'A' }] })),
    ).toBeNull()
  })

  it('refuses a menu-only conversation with no menu — the customer could say nothing at all', () => {
    expect(validateMessengerProfile(config({ composerInputDisabled: true, menuItems: [] }))).toContain('לא יוכל לכתוב')
  })

  it('names the limit it enforces, so the admin can act on it', () => {
    expect(validateMessengerProfile(config({ greeting: 'א'.repeat(GREETING_MAX + 1) }))).toContain(String(GREETING_MAX))
  })
})
