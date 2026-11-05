import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { withoutUrls } from '@/lib/ai/router/attemptLogger'

describe('a signed image URL cannot reach the logs through a model error', () => {
  it('removes URLs and their query strings', () => {
    const message = 'Failed to download https://a.r2.cloudflarestorage.com/b/tenants/1/uploads/x.webp?X-Amz-Signature=abc&X-Amz-Credential=key returned 403'
    expect(withoutUrls(message)).toBe('Failed to download [url] returned 403')
  })

  it('leaves ordinary errors alone', () => {
    expect(withoutUrls('rate limit exceeded, status 429')).toBe('rate limit exceeded, status 429')
  })

  it('the router applies it before anything logs the message', () => {
    expect(readFileSync('lib/ai/router.ts', 'utf8')).toContain("const message = withoutUrls((err as Error)?.message ?? 'unknown')")
  })
})
