import { graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'

/**
 * The Messenger Profile API — a Page's greeting, Get Started button and
 * persistent menu.
 *
 * Per https://developers.facebook.com/docs/messenger-platform/reference/messenger-profile-api/
 * (checked 2026-09-23) this needs `pages_messaging` only, which is approved, and
 * is applied to `/{PAGE-ID}/messenger_profile`.
 *
 * RATE LIMIT: 10 calls per 10 minutes PER PAGE. That is low enough that a UI
 * which saved on every keystroke would exhaust it in seconds, which is why the
 * settings form saves explicitly and reads once.
 *
 * ORDER MATTERS. Meta requires a Get Started button to exist before a persistent
 * menu can be set, so `saveMessengerProfile` sends them in one POST — Meta
 * applies the fields in a single transaction, and sending the menu on its own
 * against a Page with no Get Started is the documented way to get a confusing
 * refusal.
 *
 * NEVER THROWS: typed errors, like every other Graph call here.
 */

/** A persistent-menu entry. Only postback items — SocialCRM sends no web_url. */
export type MessengerMenuItem = {
  type: 'postback'
  title: string
  payload: string
}

export type MessengerProfileConfig = {
  /** Shown before the conversation starts. Empty string ⇒ not set. */
  greeting: string
  /** The payload delivered when the person taps Get Started. */
  getStartedPayload: string
  menuItems: MessengerMenuItem[]
  /** When true the person can ONLY use the menu. Off by default — see below. */
  composerInputDisabled: boolean
}

/** Meta's limits for the persistent menu. */
export const MENU_MAX_ITEMS = 3
export const MENU_TITLE_MAX = 30
export const GREETING_MAX = 160
export const GET_STARTED_PAYLOAD = 'GET_STARTED'

export const EMPTY_MESSENGER_PROFILE: MessengerProfileConfig = {
  greeting: '',
  getStartedPayload: GET_STARTED_PAYLOAD,
  menuItems: [],
  composerInputDisabled: false,
}

type ProfileResponse = { data?: unknown }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Meta returns `data: [ { ...fields } ]`, or `data: []` when nothing is set. */
export function parseMessengerProfile(body: unknown): MessengerProfileConfig {
  const entry = Array.isArray((body as ProfileResponse)?.data) ? (body as { data: unknown[] }).data[0] : null
  if (!entry || typeof entry !== 'object') return { ...EMPTY_MESSENGER_PROFILE }
  const e = entry as Record<string, unknown>

  const greetings = Array.isArray(e.greeting) ? (e.greeting as Record<string, unknown>[]) : []
  // Only the `default` locale is managed. A Page that has per-locale greetings
  // set elsewhere keeps them; this UI never claims to show or replace them.
  const greeting = str(greetings.find((g) => g?.locale === 'default')?.text)

  const menus = Array.isArray(e.persistent_menu) ? (e.persistent_menu as Record<string, unknown>[]) : []
  const menu = menus.find((m) => m?.locale === 'default')
  const actions = Array.isArray(menu?.call_to_actions) ? (menu.call_to_actions as Record<string, unknown>[]) : []

  return {
    greeting,
    getStartedPayload: str((e.get_started as Record<string, unknown> | undefined)?.payload) || GET_STARTED_PAYLOAD,
    menuItems: actions
      // web_url items are shown read-only nowhere and must not be silently
      // converted to postbacks on the next save, so they are dropped from the
      // editable model and left to Meta's own tools.
      .filter((a) => a?.type === 'postback' && str(a.title))
      .slice(0, MENU_MAX_ITEMS)
      .map((a) => ({ type: 'postback' as const, title: str(a.title), payload: str(a.payload) })),
    composerInputDisabled: menu?.composer_input_disabled === true,
  }
}

export async function getMessengerProfile(input: {
  pageId: string
  pageAccessToken: string
  fetchImpl?: typeof fetch
  // Narrowed with `'error' in result` by callers — this project compiles with
  // strictNullChecks off, where a boolean-literal discriminant does not narrow.
}): Promise<{ profile: MessengerProfileConfig } | { error: MetaGraphError }> {
  const result = await graphRequest<ProfileResponse>({
    path: `/${encodeURIComponent(input.pageId)}/messenger_profile`,
    token: input.pageAccessToken,
    query: { fields: 'get_started,greeting,persistent_menu' },
    fetchImpl: input.fetchImpl,
  })
  if ('error' in result) return { error: result.error }
  return { profile: parseMessengerProfile(result.data) }
}

/**
 * Build the POST body. Pure, so the exact shape sent to Meta is testable
 * without a network call.
 *
 * A menu is only included when there is something in it: Meta rejects a
 * persistent_menu whose `call_to_actions` is empty, and the way to have no menu
 * is to DELETE the field, not to send an empty one.
 */
export function messengerProfileBody(config: MessengerProfileConfig): Record<string, unknown> {
  const body: Record<string, unknown> = {
    get_started: { payload: config.getStartedPayload || GET_STARTED_PAYLOAD },
  }
  if (config.greeting.trim()) {
    body.greeting = [{ locale: 'default', text: config.greeting.trim().slice(0, GREETING_MAX) }]
  }
  const items = config.menuItems.filter((i) => i.title.trim()).slice(0, MENU_MAX_ITEMS)
  if (items.length > 0) {
    body.persistent_menu = [
      {
        locale: 'default',
        // Leaving the composer ENABLED is the default on purpose: disabling it
        // traps a customer who wants to type something the menu does not cover,
        // and they cannot then reach a human at all.
        composer_input_disabled: config.composerInputDisabled,
        call_to_actions: items.map((i) => ({
          type: 'postback',
          title: i.title.trim().slice(0, MENU_TITLE_MAX),
          payload: (i.payload || i.title).trim().slice(0, 1000),
        })),
      },
    ]
  }
  return body
}

/** Fields that must be cleared because the new config no longer has them. */
export function messengerProfileFieldsToDelete(config: MessengerProfileConfig): string[] {
  const fields: string[] = []
  if (!config.greeting.trim()) fields.push('greeting')
  if (config.menuItems.filter((i) => i.title.trim()).length === 0) fields.push('persistent_menu')
  return fields
}

export async function saveMessengerProfile(input: {
  pageId: string
  pageAccessToken: string
  config: MessengerProfileConfig
  fetchImpl?: typeof fetch
}): Promise<{ saved: true } | { error: MetaGraphError }> {
  const path = `/${encodeURIComponent(input.pageId)}/messenger_profile`

  // Clear first. Meta merges a POST into what is already set, so a greeting the
  // user emptied would otherwise survive the save and keep greeting customers.
  const toDelete = messengerProfileFieldsToDelete(input.config)
  if (toDelete.length > 0) {
    const cleared = await graphRequest({
      method: 'DELETE',
      path,
      token: input.pageAccessToken,
      body: { fields: toDelete },
      fetchImpl: input.fetchImpl,
    })
    // A field that was never set returns an error on DELETE. That is the
    // desired end state, so it is not a failure.
    if ('error' in cleared && cleared.error.kind !== 'graph') return { error: cleared.error }
  }

  const result = await graphRequest({
    method: 'POST',
    path,
    token: input.pageAccessToken,
    body: messengerProfileBody(input.config),
    fetchImpl: input.fetchImpl,
  })
  if ('error' in result) return { error: result.error }
  return { saved: true }
}
