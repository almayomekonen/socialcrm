// @vitest-environment jsdom
//
// The Meta Pixel was the last application-owned inline script that EXECUTES.
// Moving it into bundled module code takes that count to zero, which is the
// precondition for a future nonce-based script-src. These tests pin both halves:
// the count stays zero, and the queue behaviour the port had to preserve.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ensureFbq } from '@/lib/facebook/fbqBootstrap'

beforeEach(() => {
  delete (window as { fbq?: unknown }).fbq
  delete (window as { _fbq?: unknown })._fbq
})

describe('fbq stub — a faithful port of Meta\'s snippet', () => {
  test('installs the queue markers the SDK looks for', () => {
    ensureFbq()
    const fbq = window.fbq as unknown as { queue: unknown[]; loaded: boolean; version: string; push: unknown }
    expect(typeof window.fbq).toBe('function')
    expect(fbq.queue).toEqual([])
    expect(fbq.loaded).toBe(true)
    expect(fbq.version).toBe('2.0')
    expect(fbq.push).toBe(window.fbq)
    expect(window._fbq).toBe(window.fbq)
  })

  /**
   * The queue is load-bearing, not decoration: trackPixelEvent() can fire before
   * fbevents.js arrives, and those calls must be replayed rather than dropped.
   */
  test('queues calls made before the SDK loads', () => {
    ensureFbq()
    window.fbq?.('init', '123')
    window.fbq?.('track', 'PageView')
    const fbq = window.fbq as unknown as { queue: unknown[][] }
    expect(fbq.queue).toEqual([
      ['init', '123'],
      ['track', 'PageView'],
    ])
  })

  test('hands straight to the SDK once it sets callMethod', () => {
    ensureFbq()
    const seen: unknown[][] = []
    const fbq = window.fbq as unknown as { callMethod?: (...a: unknown[]) => void; queue: unknown[][] }
    fbq.callMethod = (...args: unknown[]) => void seen.push(args)

    window.fbq?.('track', 'Subscribe')
    expect(seen).toEqual([['track', 'Subscribe']])
    expect(fbq.queue).toEqual([])
  })

  test('never replaces a live pixel (Meta\'s `if (f.fbq) return`)', () => {
    const existing = (() => {}) as unknown as Window['fbq']
    window.fbq = existing
    ensureFbq()
    expect(window.fbq).toBe(existing)
  })

  test('is safe to call twice', () => {
    ensureFbq()
    const first = window.fbq
    ensureFbq()
    expect(window.fbq).toBe(first)
  })
})

describe('no application-owned executing inline script remains', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/facebook/MetaPixel.tsx'), 'utf8')

  test('MetaPixel loads fbevents.js as an EXTERNAL script', () => {
    expect(src).toContain("<Script src='https://connect.facebook.net/en_US/fbevents.js'")
    // Same strategy the inline snippet shipped under — this is a port, not a
    // behaviour change.
    expect(src).toContain("strategy='afterInteractive'")
  })

  test('MetaPixel contains no inline <Script> body', () => {
    // The old form was `<Script id='meta-pixel' ...>{`!function(f,b,e,v,n,t,s)...`}</Script>`.
    expect(src).not.toContain('!function(f,b,e,v,n,t,s)')
    expect(src).not.toMatch(/<Script(?![^>]*\ssrc=)[^>]*>\s*\{`/)
  })

  test('no dangerouslySetInnerHTML anywhere in the pixel path', () => {
    expect(src).not.toContain('dangerouslySetInnerHTML')
    const boot = fs.readFileSync(path.join(process.cwd(), 'lib/facebook/fbqBootstrap.ts'), 'utf8')
    expect(boot).not.toContain('dangerouslySetInnerHTML')
    expect(boot).not.toContain('innerHTML')
  })
})
