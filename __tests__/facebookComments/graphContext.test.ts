/**
 * Graph reads behind the comments inbox: the post a comment was left on, and
 * the commenter's picture. Driven with a fetch stub — no network.
 *
 * What is pinned: the exact documented fields requested, the mapping, that
 * Meta's silhouette is never treated as a photo, that a vanished post and a
 * refusal are told apart from a blip, that only https URLs Meta returned are
 * kept, and that the token never appears in a URL.
 */
import { describe, expect, it, vi } from 'vitest'
import { fetchAuthorPicture, fetchPostContext, POST_MESSAGE_MAX } from '@/lib/facebook/comments/graphContext'

const TOKEN = 'PAGE_TOKEN_SECRET'

function stub(status: number, body: unknown) {
  return vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
}
const graphError = (code: number, subcode?: number) => ({
  error: { message: 'x', type: 'OAuthException', code, ...(subcode ? { error_subcode: subcode } : {}) },
})

describe('fetchPostContext — post context mapping', () => {
  it('requests exactly the documented post fields with the Page token in a header', async () => {
    const fetchImpl = stub(200, { id: 'P_1' })
    await fetchPostContext({ postId: '111_222', token: TOKEN, fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]
    const u = new URL(String(url))
    expect(u.pathname).toMatch(/\/111_222$/)
    expect(u.searchParams.get('fields')).toBe('message,full_picture,permalink_url,created_time,status_type')
    expect(String(url)).not.toContain(TOKEN)
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('maps message, picture, permalink, type and time', async () => {
    const fetchImpl = stub(200, {
      id: '111_222',
      message: '  מבצע סוף עונה  ',
      full_picture: 'https://scontent.xx.fbcdn.net/v/p.jpg?oh=1',
      permalink_url: 'https://www.facebook.com/111/posts/222',
      created_time: '2026-10-01T08:00:00+0000',
      status_type: 'added_photos',
    })
    expect(await fetchPostContext({ postId: '111_222', token: TOKEN, fetchImpl })).toEqual({
      status: 'ok',
      message: 'מבצע סוף עונה',
      pictureUrl: 'https://scontent.xx.fbcdn.net/v/p.jpg?oh=1',
      permalinkUrl: 'https://www.facebook.com/111/posts/222',
      statusType: 'added_photos',
      createdTime: new Date('2026-10-01T08:00:00Z'),
    })
  })

  it('a text-only post has no picture, and long copy is cut once, here', async () => {
    const fetchImpl = stub(200, { id: '1', message: 'א'.repeat(POST_MESSAGE_MAX + 50) })
    const ctx = await fetchPostContext({ postId: '1', token: TOKEN, fetchImpl })
    expect(ctx).toMatchObject({ status: 'ok', pictureUrl: null, permalinkUrl: null })
    expect('message' in ctx && ctx.message?.length).toBe(POST_MESSAGE_MAX)
  })

  it('keeps only https URLs, and a permalink only when it is Facebook', async () => {
    const fetchImpl = stub(200, {
      id: '1',
      full_picture: 'http://insecure.example/p.jpg',
      permalink_url: 'https://evil.example/facebook.com/1',
    })
    expect(await fetchPostContext({ postId: '1', token: TOKEN, fetchImpl })).toMatchObject({ pictureUrl: null, permalinkUrl: null })
  })

  it('a deleted / unreadable post (100 + subcode 33) is unavailable, not an error to retry', async () => {
    expect(await fetchPostContext({ postId: '1', token: TOKEN, fetchImpl: stub(400, graphError(100, 33)) })).toEqual({
      status: 'unavailable',
    })
  })

  it('a bare 100 is NOT read as a deleted post', async () => {
    expect((await fetchPostContext({ postId: '1', token: TOKEN, fetchImpl: stub(400, graphError(100)) })).status).toBe('transient')
  })

  it.each([10, 200, 283])('permission error %i is a refusal', async (code) => {
    expect((await fetchPostContext({ postId: '1', token: TOKEN, fetchImpl: stub(400, graphError(code)) })).status).toBe('denied')
  })

  it('a network failure or rate limit is transient — nothing is recorded, next pass retries', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await fetchPostContext({ postId: '1', token: TOKEN, fetchImpl: down })).status).toBe('transient')
    expect((await fetchPostContext({ postId: '1', token: TOKEN, fetchImpl: stub(400, graphError(4)) })).status).toBe('transient')
  })
})

describe('fetchAuthorPicture — commenter avatar', () => {
  it('asks the documented picture edge for JSON, by the id Meta gave — never a constructed image URL', async () => {
    const fetchImpl = stub(200, { data: { url: 'https://scontent.xx.fbcdn.net/a.jpg', is_silhouette: false } })
    await fetchAuthorPicture({ authorId: '5566', token: TOKEN, fetchImpl })
    const u = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(u.pathname).toMatch(/\/5566\/picture$/)
    expect(u.searchParams.get('redirect')).toBe('0')
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain(TOKEN)
  })

  it('a real picture is returned as-is', async () => {
    const fetchImpl = stub(200, { data: { url: 'https://scontent.xx.fbcdn.net/a.jpg', is_silhouette: false } })
    expect(await fetchAuthorPicture({ authorId: '5566', token: TOKEN, fetchImpl })).toEqual({
      status: 'ok',
      url: 'https://scontent.xx.fbcdn.net/a.jpg',
    })
  })

  it("Meta's generic silhouette is 'none' — never shown as the person's photo", async () => {
    const fetchImpl = stub(200, { data: { url: 'https://scontent.xx.fbcdn.net/silhouette.jpg', is_silhouette: true } })
    expect(await fetchAuthorPicture({ authorId: '5566', token: TOKEN, fetchImpl })).toEqual({ status: 'none' })
  })

  it('no URL, or a non-https one, is none', async () => {
    expect(await fetchAuthorPicture({ authorId: '1', token: TOKEN, fetchImpl: stub(200, { data: {} }) })).toEqual({ status: 'none' })
    expect(
      await fetchAuthorPicture({ authorId: '1', token: TOKEN, fetchImpl: stub(200, { data: { url: 'http://x/a.jpg' } }) }),
    ).toEqual({ status: 'none' })
  })

  it('a refusal is denied; a blip is transient', async () => {
    expect((await fetchAuthorPicture({ authorId: '1', token: TOKEN, fetchImpl: stub(403, graphError(200)) })).status).toBe('denied')
    expect((await fetchAuthorPicture({ authorId: '1', token: TOKEN, fetchImpl: stub(500, graphError(2)) })).status).toBe('transient')
  })
})
