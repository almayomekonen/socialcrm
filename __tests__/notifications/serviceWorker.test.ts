import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Service worker contract — P3.1. Spec §20.7.
 *
 * A caching or fetch-handling SW on an authenticated origin is a cross-session
 * leak vector. This file is the hard constraint, enforced by review AND by this
 * test so a later edit cannot quietly add a fetch handler.
 */

const SW = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

describe('public/sw.js — push-only', () => {
  it('registers a push handler', () => {
    expect(SW).toMatch(/addEventListener\(\s*['"]push['"]/)
  })

  it('registers a notificationclick handler', () => {
    expect(SW).toMatch(/addEventListener\(\s*['"]notificationclick['"]/)
  })

  it('does NOT register a fetch handler', () => {
    expect(SW).not.toMatch(/addEventListener\(\s*['"]fetch['"]/)
    expect(SW).not.toMatch(/onfetch\s*=/)
  })

  it('does not open caches or store authenticated data', () => {
    expect(SW).not.toMatch(/caches\./)
    expect(SW).not.toMatch(/cache\.put/)
    expect(SW).not.toMatch(/indexedDB/i)
    expect(SW).not.toMatch(/localStorage/)
    expect(SW).not.toMatch(/sessionStorage/)
  })

  it('payload surface is title/body/deepLink only — no PII field names', () => {
    expect(SW).not.toMatch(/\bphone\b/)
    expect(SW).not.toMatch(/\bidNum\b/)
    expect(SW).not.toMatch(/\bemail\b/)
  })

  it('does not import or call web-push / sendNotification delivery APIs', () => {
    expect(SW).not.toMatch(/web-push/)
    expect(SW).not.toMatch(/sendNotification/)
  })

  it('proxy allows /sw.js without auth — matcher exclusion and early next()', () => {
    const proxy = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8')
    expect(proxy).toContain('sw\\\\.js$')
    expect(proxy).toContain("pathname === '/sw.js'")
  })
})

describe('P3.1 does not enable WEB_PUSH delivery', () => {
  it('processJob still uses IN_APP_ONLY_CAPABILITIES', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/notifications/processJob.ts'), 'utf8')
    expect(src).toMatch(/IN_APP_ONLY_CAPABILITIES/)
    expect(src).not.toMatch(/web-push/)
  })

  it('no server module in this phase imports web-push', () => {
    const files = [
      'lib/notifications/vapid.ts',
      'lib/notifications/pushSubscriptionSchema.ts',
      'db/notifications/subscriptions.ts',
      'app/api/notifications/push/route.ts',
      'app/api/notifications/push/subscribe/route.ts',
      'app/api/notifications/push/unsubscribe/route.ts',
      'modules/notifications/pushLifecycle.ts',
    ]
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(src, file).not.toMatch(/from ['"]web-push['"]/)
      expect(src, file).not.toMatch(/webpush\.sendNotification/)
    }
  })
})
