// @vitest-environment jsdom
//
// The development device override must SURVIVE client-side navigation.
//
// THE BUG THIS LOCKS. `?device=phone` lives only in the URL. Any client
// navigation that builds its own href dropped it — measured on
// `/leads?device=phone` → search submit → `/leads?q=דני`. When it drops
// mid-session the server renders the next page for the REAL device while the
// already-mounted shell stays put, producing a mobile shell wrapped around the
// desktop leads table.
//
// WHAT IS NOT THE GOAL. Nothing here classifies a device. DevTools Responsive
// mode with a desktop User-Agent must remain DESKTOP; `getDeviceClass()` stays
// the sole authority. These tests only prove that an override you typed yourself
// stays attached, and that it can never reach production.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const pushed: string[] = []
const replaced: string[] = []

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (u: string) => pushed.push(u), replace: (u: string) => replaced.push(u), back: () => {} }),
  usePathname: () => '/leads',
}))

let requestHeaders = new Headers()
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }))

import { withDeviceOverride, isDeviceOverrideAllowed, DEVICE_OVERRIDE_HEADER } from '@/lib/deviceOverride'
import { getActiveDeviceOverride, getDeviceClass } from '@/lib/device'
import DeviceOverrideLinks from '@/components/dev/DeviceOverrideLinks'

beforeEach(() => {
  pushed.length = 0
  replaced.length = 0
})
afterEach(cleanup)

/* ------------------------------------------------------------------ */
/* The URL rule — one pure function, shared by both navigation paths    */
/* ------------------------------------------------------------------ */

describe('withDeviceOverride — internal destinations carry the override', () => {
  test('a bare internal path gains the parameter', () => {
    expect(withDeviceOverride('/leads', 'phone')).toBe('/leads?device=phone')
  })

  test('?device=desktop is carried just the same', () => {
    expect(withDeviceOverride('/leads', 'desktop')).toBe('/leads?device=desktop')
  })

  test('EXISTING QUERY PARAMS REMAIN INTACT — the measured failure case', () => {
    // `router.push(leadsHref({q:'test'}))` is exactly what dropped the override.
    expect(withDeviceOverride('/leads?q=test', 'phone')).toBe('/leads?q=test&device=phone')
  })

  test('multiple existing params all survive, in order', () => {
    expect(withDeviceOverride('/leads?q=dan&status=new', 'phone')).toBe('/leads?q=dan&status=new&device=phone')
  })

  test('a hash is preserved and stays last', () => {
    expect(withDeviceOverride('/settings/integrations#whatsapp', 'phone')).toBe(
      '/settings/integrations?device=phone#whatsapp',
    )
  })

  test('dynamically generated destinations work like any other path', () => {
    expect(withDeviceOverride('/clients/42/summary', 'phone')).toBe('/clients/42/summary?device=phone')
    expect(withDeviceOverride('/inbox?conversation=7', 'phone')).toBe('/inbox?conversation=7&device=phone')
  })
})

describe('withDeviceOverride — everything it must NOT touch', () => {
  test.each([
    ['https://getsocialcrm.com/leads', 'absolute external'],
    ['http://example.com/', 'absolute external, http'],
    ['//cdn.example.com/x', 'PROTOCOL-RELATIVE — starts with / but is another origin'],
    ['mailto:hi@example.com', 'mailto'],
    ['tel:+972500000000', 'tel'],
    ['#section', 'in-page fragment'],
    ['', 'empty'],
  ])('%s is returned unchanged (%s)', (url) => {
    expect(withDeviceOverride(url, 'phone')).toBe(url)
  })

  test('a URL that already carries ?device= is never overwritten', () => {
    expect(withDeviceOverride('/leads?device=desktop', 'phone')).toBe('/leads?device=desktop')
    expect(withDeviceOverride('/leads?q=x&device=phone', 'desktop')).toBe('/leads?q=x&device=phone')
  })

  test('with no active override nothing is rewritten at all', () => {
    expect(withDeviceOverride('/leads', null)).toBe('/leads')
    expect(withDeviceOverride('/leads?q=test', undefined)).toBe('/leads?q=test')
  })
})

/* ------------------------------------------------------------------ */
/* Path 1 — <Link> clicks                                              */
/* ------------------------------------------------------------------ */

describe('Next <Link> navigation preserves the override', () => {
  const renderWithLink = (href: string, device: 'phone' | 'desktop' | null = 'phone', attrs = {}) => {
    render(
      <DeviceOverrideLinks device={device}>
        <a href={href} {...attrs}>
          go
        </a>
      </DeviceOverrideLinks>,
    )
    return screen.getByText('go')
  }

  test('a link click is rewritten and handed to the router', () => {
    const a = renderWithLink('/leads')
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    a.dispatchEvent(evt)
    expect(pushed[0]).toBe('/leads?device=phone')
    // preventDefault is what hands over: next/link bails on defaultPrevented.
    expect(evt.defaultPrevented).toBe(true)
  })

  test('existing params survive a link click', () => {
    const a = renderWithLink('/leads?status=new')
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(pushed[0]).toBe('/leads?status=new&device=phone')
  })

  test.each([['https://example.com/x'], ['mailto:a@b.c'], ['tel:+972500000000'], ['//cdn.example.com/x'], ['#top']])(
    '%s is left to the browser',
    (href) => {
      const a = renderWithLink(href)
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      a.dispatchEvent(evt)
      expect(pushed).toHaveLength(0)
      expect(evt.defaultPrevented).toBe(false)
    },
  )

  test('modified clicks and new-tab targets are never hijacked', () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      cleanup()
      pushed.length = 0
      const a = renderWithLink('/leads')
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }))
      expect(pushed).toHaveLength(0)
    }
  })

  test('with no override the listener does not attach', () => {
    const a = renderWithLink('/leads', null)
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(pushed).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* Path 2 — router.push / router.replace via AppRouterContext          */
/* ------------------------------------------------------------------ */

describe('router.push / router.replace preserve the override', () => {
  const calls: { push: string[]; replace: string[] } = { push: [], replace: [] }

  function Probe() {
    // Reads the router the same way every app call site does.
    const { useRouter } = require('next/navigation') as { useRouter: () => never }
    void useRouter
    return null
  }
  void Probe

  /**
   * The wrapper is verified against the real context: a fake router is placed on
   * `AppRouterContext`, the component wraps it, and a child reads it back with
   * `useContext` — the same lookup `next/navigation`'s `useRouter()` performs.
   */
  function Child() {
    const { useContext } = require('react')
    const {
      AppRouterContext,
    } = require('next/dist/shared/lib/app-router-context.shared-runtime')
    const r = useContext(AppRouterContext)
    return (
      <>
        <button onClick={() => r.push('/leads?q=test')}>push</button>
        <button onClick={() => r.replace('/leads?status=new')}>replace</button>
        <button onClick={() => r.push('https://example.com/x')}>push-external</button>
        <button onClick={() => r.push('/leads?device=desktop')}>push-explicit</button>
      </>
    )
  }

  function renderWrapped(device: 'phone' | 'desktop' | null) {
    calls.push.length = 0
    calls.replace.length = 0
    const {
      AppRouterContext,
    } = require('next/dist/shared/lib/app-router-context.shared-runtime')
    const base = {
      push: (u: string) => calls.push.push(u),
      replace: (u: string) => calls.replace.push(u),
      prefetch: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {},
    }
    render(
      <AppRouterContext.Provider value={base}>
        <DeviceOverrideLinks device={device}>
          <Child />
        </DeviceOverrideLinks>
      </AppRouterContext.Provider>,
    )
  }

  test('router.push keeps ?device=phone and existing params', () => {
    renderWrapped('phone')
    fireEvent.click(screen.getByText('push'))
    expect(calls.push[0]).toBe('/leads?q=test&device=phone')
  })

  test('router.push keeps ?device=desktop', () => {
    renderWrapped('desktop')
    fireEvent.click(screen.getByText('push'))
    expect(calls.push[0]).toBe('/leads?q=test&device=desktop')
  })

  test('router.replace keeps the override', () => {
    renderWrapped('phone')
    fireEvent.click(screen.getByText('replace'))
    expect(calls.replace[0]).toBe('/leads?status=new&device=phone')
  })

  test('external destinations pushed through the router are untouched', () => {
    renderWrapped('phone')
    fireEvent.click(screen.getByText('push-external'))
    expect(calls.push[0]).toBe('https://example.com/x')
  })

  test('an explicit ?device= in the pushed URL wins', () => {
    renderWrapped('phone')
    fireEvent.click(screen.getByText('push-explicit'))
    expect(calls.push[0]).toBe('/leads?device=desktop')
  })

  test('with no override the router is passed through untouched', () => {
    renderWrapped(null)
    fireEvent.click(screen.getByText('push'))
    expect(calls.push[0]).toBe('/leads?q=test')
  })
})

/* ------------------------------------------------------------------ */
/* Production safety                                                    */
/* ------------------------------------------------------------------ */

describe('production can never honour the override', () => {
  const NODE = process.env.NODE_ENV
  const setNode = (v: string | undefined) => {
    if (v === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
    else (process.env as Record<string, string | undefined>).NODE_ENV = v
  }
  afterEach(() => setNode(NODE))

  test('production ignores ?device= completely — the component is never mounted', async () => {
    setNode('production')
    expect(isDeviceOverrideAllowed()).toBe(false)
    requestHeaders = new Headers({ [DEVICE_OVERRIDE_HEADER]: 'phone' })
    expect(await getActiveDeviceOverride()).toBeNull()
  })

  test('an inbound override header is rejected in production — UA still decides', async () => {
    setNode('production')
    requestHeaders = new Headers({
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      [DEVICE_OVERRIDE_HEADER]: 'phone',
    })
    expect(await getDeviceClass()).toBe('desktop')
  })

  test('a DESKTOP User-Agent in a narrow viewport is still DESKTOP — the fix must not change classification', async () => {
    // DevTools "Responsive" keeps the desktop UA. That must stay DESKTOP: this
    // work preserves an explicit choice, it does not invent one.
    setNode('development')
    requestHeaders = new Headers({
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    })
    expect(await getDeviceClass()).toBe('desktop')
  })

  test('a real phone User-Agent is still PHONE with no override present', async () => {
    setNode('development')
    requestHeaders = new Headers({
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    })
    expect(await getDeviceClass()).toBe('phone')
  })
})
