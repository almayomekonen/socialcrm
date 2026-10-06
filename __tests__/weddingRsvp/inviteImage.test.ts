import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import { INVITE_IMAGE_PATH, INVITE_IMAGE_URL } from '@/lib/weddingRsvp/config'

/**
 * Meta fetches the template header image from INVITE_IMAGE_URL on every send.
 * These guard the three ways that silently breaks: the file is missing from
 * `public/`, it is not an image Meta accepts (JPEG/PNG, ≤ 5 MB), or the auth
 * proxy intercepts it (proxy.ts excludes `.jpg` but NOT `.jpeg` from its matcher —
 * a `.jpeg` path would 307 to /auth and Meta would get an HTML page).
 */

const file = join(process.cwd(), 'public', INVITE_IMAGE_PATH)

describe('wedding invite header image', () => {
  it('is served from a .jpg path the auth proxy does not intercept', () => {
    expect(INVITE_IMAGE_PATH).toMatch(/^\/wedding\/[a-z0-9-]+\.jpg$/)
    const proxy = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8')
    expect(proxy).toContain('.*\\\\.jpg$')
    expect(INVITE_IMAGE_URL).toBe(`https://getsocialcrm.com${INVITE_IMAGE_PATH}`)
  })

  it('exists in public/ as a real JPEG within Meta’s 5 MB image limit', () => {
    const { size } = statSync(file)
    expect(size).toBeGreaterThan(1024)
    expect(size).toBeLessThanOrEqual(5 * 1024 * 1024)
    const head = readFileSync(file).subarray(0, 3)
    expect([...head]).toEqual([0xff, 0xd8, 0xff])
  })
})
