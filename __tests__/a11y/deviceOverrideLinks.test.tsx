// @vitest-environment jsdom
//
// The development-only override preserver.
//
// WHY IT EXISTS. `?device=phone` is stateless by design — it lives in the URL
// and nowhere else. But `<Link href='/leads'>` navigates to exactly that href,
// so without this the first tap drops the parameter and the app snaps back to
// the desktop entity, which makes the override useless for walking the phone
// workspace locally.
//
// WHAT MUST NEVER REGRESS — the parameter is an INSPECTION AID, so its blast
// radius has to stay tiny:
//   · internal path-absolute links carry it forward
//   · external URLs, mailto:, tel: and #fragments are never touched
//   · modified clicks (new tab / new window) behave exactly as the browser
//     intends
//   · production never mounts this at all
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, beforeEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

const pushed: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (url: string) => pushed.push(url), back: () => {} }),
  usePathname: () => '/dashboard',
}))

import DeviceOverrideLinks from '@/components/dev/DeviceOverrideLinks'
import { getActiveDeviceOverride } from '@/lib/device'
import { DEVICE_OVERRIDE_HEADER } from '@/lib/deviceOverride'

let requestHeaders = new Headers()
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }))

beforeEach(() => {
  pushed.length = 0
})
afterEach(cleanup)

/** Render the preserver, then click a real anchor and report what it did. */
function clickAnchor(
  attrs: Record<string, string>,
  init: MouseEventInit = {},
  device: 'phone' | 'desktop' = 'phone',
) {
  render(<DeviceOverrideLinks device={device}>{null}</DeviceOverrideLinks>)

  const a = document.createElement('a')
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
  a.textContent = 'link'
  document.body.appendChild(a)

  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  a.dispatchEvent(event)

  const result = { pushed: pushed[0] ?? null, prevented: event.defaultPrevented }
  a.remove()
  return result
}

describe('internal navigation carries the override forward', () => {
  test('a plain internal link gains ?device=phone', () => {
    const r = clickAnchor({ href: '/leads' })
    expect(r.pushed).toBe('/leads?device=phone')
    // preventDefault is what hands the navigation over: next/link's onClick
    // starts with `if (e.defaultPrevented) return`.
    expect(r.prevented).toBe(true)
  })

  test('?device=desktop is preserved just the same', () => {
    const r = clickAnchor({ href: '/leads' }, {}, 'desktop')
    expect(r.pushed).toBe('/leads?device=desktop')
  })

  test('existing query parameters survive', () => {
    expect(clickAnchor({ href: '/leads?status=new&page=2' }).pushed).toBe(
      '/leads?status=new&page=2&device=phone',
    )
  })

  test('a hash is preserved', () => {
    expect(clickAnchor({ href: '/settings/integrations#whatsapp' }).pushed).toBe(
      '/settings/integrations?device=phone#whatsapp',
    )
  })

  test('the full example chain keeps the phone entity', () => {
    // /leads → lead detail → notifications → more → settings
    for (const [href, expected] of [
      ['/clients/12/summary', '/clients/12/summary?device=phone'],
      ['/notifications', '/notifications?device=phone'],
      ['/m', '/m?device=phone'],
      ['/settings/self_edit', '/settings/self_edit?device=phone'],
    ] as const) {
      pushed.length = 0
      expect(clickAnchor({ href }).pushed, href).toBe(expected)
      cleanup()
    }
  })

  test('a link that already carries the parameter is left alone', () => {
    const r = clickAnchor({ href: '/leads?device=desktop' })
    expect(r.pushed).toBeNull()
    expect(r.prevented).toBe(false)
  })

  test('a click on an element INSIDE a link still counts', () => {
    render(<DeviceOverrideLinks device='phone'>{null}</DeviceOverrideLinks>)
    const a = document.createElement('a')
    a.setAttribute('href', '/inbox')
    const span = document.createElement('span')
    a.appendChild(span)
    document.body.appendChild(a)
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(pushed[0]).toBe('/inbox?device=phone')
    a.remove()
  })
})

describe('the parameter never leaks outside the app', () => {
  test.each([
    ['https://getsocialcrm.com/leads'],
    ['http://example.com/'],
    ['//cdn.example.com/x'],
    ['mailto:hi@example.com'],
    ['tel:+972500000000'],
    ['#section'],
  ])('%s is untouched', (href) => {
    const r = clickAnchor({ href })
    expect(r.pushed).toBeNull()
    expect(r.prevented).toBe(false)
  })

  test('an anchor with no href is ignored', () => {
    const r = clickAnchor({})
    expect(r.pushed).toBeNull()
  })
})

describe('browser-native behaviours are not hijacked', () => {
  test.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }],
    ['middle click', { button: 1 }],
  ])('%s opens normally, untouched', (_label, init) => {
    const r = clickAnchor({ href: '/leads' }, init as MouseEventInit)
    expect(r.pushed).toBeNull()
    expect(r.prevented).toBe(false)
  })

  test('target="_blank" is left to the browser', () => {
    expect(clickAnchor({ href: '/leads', target: '_blank' }).pushed).toBeNull()
  })

  test('a download link is left to the browser', () => {
    expect(clickAnchor({ href: '/api/export.csv', download: '' }).pushed).toBeNull()
  })

  test('the listener is removed on unmount — no leak into the rest of the app', () => {
    const { unmount } = render(<DeviceOverrideLinks device='phone'>{null}</DeviceOverrideLinks>)
    unmount()
    const a = document.createElement('a')
    a.setAttribute('href', '/leads')
    document.body.appendChild(a)
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(pushed).toHaveLength(0)
    a.remove()
  })
})

describe('production never mounts it', () => {
  const NODE = process.env.NODE_ENV
  const setNode = (v: string | undefined) => {
    if (v === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
    else (process.env as Record<string, string | undefined>).NODE_ENV = v
  }
  afterEach(() => setNode(NODE))

  test('getActiveDeviceOverride is null in production, so the layout renders nothing', async () => {
    setNode('production')
    requestHeaders = new Headers({ [DEVICE_OVERRIDE_HEADER]: 'phone' })
    expect(await getActiveDeviceOverride()).toBeNull()
  })

  test('…and null under vitest too, which is why the suite is production-shaped', async () => {
    requestHeaders = new Headers({ [DEVICE_OVERRIDE_HEADER]: 'phone' })
    expect(await getActiveDeviceOverride()).toBeNull()
  })

  test('development returns the active override, and only a valid one', async () => {
    setNode('development')
    requestHeaders = new Headers({ [DEVICE_OVERRIDE_HEADER]: 'phone' })
    expect(await getActiveDeviceOverride()).toBe('phone')

    requestHeaders = new Headers({ [DEVICE_OVERRIDE_HEADER]: 'tablet' })
    expect(await getActiveDeviceOverride()).toBeNull()

    requestHeaders = new Headers()
    expect(await getActiveDeviceOverride()).toBeNull()
  })
})
