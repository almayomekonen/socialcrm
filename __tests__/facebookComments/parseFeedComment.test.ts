/**
 * Facebook `feed` comment parser — Task 2.
 *
 * The parser runs inside a signed webhook that processes a BATCH, so its two
 * hard requirements are: never throw, and never infer tenancy from payload
 * content. Both are asserted below.
 */
import { describe, it, expect } from 'vitest'
import { parseFeedComment } from '@/lib/facebook/comments/parseFeedComment'

const PAGE = '1175908668934802'
const POST = `${PAGE}_122113311069337165`
const COMMENT = '122113311069337165_987654321'
const REPLY_PARENT = '122113311069337165_111111111'

/** A real top-level comment/add, shaped exactly as production delivered it. */
const base = {
  item: 'comment',
  verb: 'add',
  comment_id: COMMENT,
  post_id: POST,
  parent_id: POST, // top-level: parent IS the post
  from: { id: '5566778899', name: 'דוד כהן' },
  created_time: 1786364410,
}

describe('parseFeedComment — happy path', () => {
  it('parses a top-level comment/add into the normalized shape', () => {
    const e = parseFeedComment(PAGE, base)!

    expect(e).toEqual({
      pageId: PAGE,
      commentId: COMMENT,
      postId: POST,
      parentId: POST,
      isTopLevel: true,
      authorId: '5566778899',
      authorName: 'דוד כהן',
      message: '',
      messageAvailable: false,
      createdTime: new Date(1786364410 * 1000),
      verb: 'add',
    })
  })

  it('carries the pageId supplied by the caller, never one derived from the payload', () => {
    // A hostile payload naming a different page must not change the pageId:
    // tenancy comes from the SIGNED entry, not from content.
    const e = parseFeedComment(PAGE, { ...base, page_id: '999999999999', pageId: '999999999999' })!

    expect(e.pageId).toBe(PAGE)
    expect(JSON.stringify(e)).not.toContain('999999999999')
  })

  it('never surfaces an agencyId, however the payload spells it', () => {
    const e = parseFeedComment(PAGE, { ...base, agency_id: 999, agencyId: 999, agency: { id: 999 } })!

    expect(e).not.toHaveProperty('agencyId')
    expect(e).not.toHaveProperty('agency_id')
    expect(JSON.stringify(e)).not.toContain('999')
  })
})

describe('parseFeedComment — top-level vs reply', () => {
  it('is top-level when parentId === postId', () => {
    expect(parseFeedComment(PAGE, base)!.isTopLevel).toBe(true)
  })

  it('is a REPLY when parentId is another comment', () => {
    const e = parseFeedComment(PAGE, { ...base, parent_id: REPLY_PARENT })!

    expect(e.isTopLevel).toBe(false)
    expect(e.parentId).toBe(REPLY_PARENT)
  })

  it('does NOT use parent_id presence as the discriminator', () => {
    // Production proved parent_id is populated on EVERY comment — for a
    // top-level comment it equals the post id. A presence check would call
    // this a reply, which is the exact bug this test locks out.
    const topLevel = parseFeedComment(PAGE, base)!
    const reply = parseFeedComment(PAGE, { ...base, parent_id: REPLY_PARENT })!

    expect(topLevel.parentId).not.toBeNull()
    expect(reply.parentId).not.toBeNull()
    expect(topLevel.isTopLevel).not.toBe(reply.isTopLevel)
  })

  it('treats a missing parent_id as top-level', () => {
    const e = parseFeedComment(PAGE, { ...base, parent_id: undefined })!

    expect(e.parentId).toBeNull()
    expect(e.isTopLevel).toBe(true)
  })
})

describe('parseFeedComment — message availability', () => {
  it('reports message unavailable while Meta withholds the text (today)', () => {
    const e = parseFeedComment(PAGE, base)!

    expect(e.message).toBe('')
    expect(e.messageAvailable).toBe(false)
  })

  it('captures the text once pages_read_user_content is granted', () => {
    const e = parseFeedComment(PAGE, { ...base, message: 'מערכת מדהימה!!' })!

    expect(e.message).toBe('מערכת מדהימה!!')
    expect(e.messageAvailable).toBe(true)
  })

  it('treats an empty-string message as unavailable, not as text', () => {
    expect(parseFeedComment(PAGE, { ...base, message: '' })!.messageAvailable).toBe(false)
  })

  it('treats a non-string message as unavailable rather than coercing it', () => {
    const e = parseFeedComment(PAGE, { ...base, message: 12345 })!

    expect(e.message).toBe('')
    expect(e.messageAvailable).toBe(false)
  })

  it('preserves whitespace-only text as available — Meta sent something', () => {
    const e = parseFeedComment(PAGE, { ...base, message: '   ' })!

    expect(e.message).toBe('   ')
    expect(e.messageAvailable).toBe(true)
  })
})

describe('parseFeedComment — verbs', () => {
  it.each(['add', 'edited', 'remove', 'hide', 'unhide'] as const)('recognises verb %s', (verb) => {
    expect(parseFeedComment(PAGE, { ...base, verb })!.verb).toBe(verb)
  })

  it('parses comment/remove even though the message is legitimately absent', () => {
    // Meta omits the body on a deletion: the comment no longer exists. That is
    // NOT the same as the permission gap, and must not be mistaken for it.
    const e = parseFeedComment(PAGE, { ...base, verb: 'remove', message: undefined })!

    expect(e.verb).toBe('remove')
    expect(e.commentId).toBe(COMMENT)
    expect(e.messageAvailable).toBe(false)
  })

  it('maps an unrecognised verb to "unknown" rather than dropping the event', () => {
    expect(parseFeedComment(PAGE, { ...base, verb: 'teleported' })!.verb).toBe('unknown')
  })

  it('maps a missing verb to "unknown"', () => {
    expect(parseFeedComment(PAGE, { ...base, verb: undefined })!.verb).toBe('unknown')
  })
})

describe('parseFeedComment — missing and hostile input', () => {
  it('returns null for a non-comment feed item', () => {
    // Production delivered 10 video/remove events during the canary; they must
    // not become comment rows.
    expect(parseFeedComment(PAGE, { ...base, item: 'video' })).toBeNull()
    expect(parseFeedComment(PAGE, { ...base, item: undefined })).toBeNull()
  })

  it('returns null without a comment_id — nothing could be deduped', () => {
    expect(parseFeedComment(PAGE, { ...base, comment_id: undefined })).toBeNull()
    expect(parseFeedComment(PAGE, { ...base, comment_id: '' })).toBeNull()
    expect(parseFeedComment(PAGE, { ...base, comment_id: 42 })).toBeNull()
  })

  it('returns null without a post_id — the comment could not be located', () => {
    expect(parseFeedComment(PAGE, { ...base, post_id: undefined })).toBeNull()
    expect(parseFeedComment(PAGE, { ...base, post_id: '' })).toBeNull()
  })

  it('returns null when the caller supplies no usable pageId', () => {
    expect(parseFeedComment('', base)).toBeNull()
    expect(parseFeedComment(undefined as unknown as string, base)).toBeNull()
    expect(parseFeedComment(null as unknown as string, base)).toBeNull()
  })

  it('tolerates a missing or malformed from block', () => {
    for (const from of [undefined, null, 'nope', 42, []]) {
      const e = parseFeedComment(PAGE, { ...base, from })!
      expect(e.authorId).toBeNull()
      expect(e.authorName).toBeNull()
    }
  })

  it('tolerates a partial from block', () => {
    const e = parseFeedComment(PAGE, { ...base, from: { id: 'U1' } })!

    expect(e.authorId).toBe('U1')
    expect(e.authorName).toBeNull()
  })

  it('nulls an unparseable created_time instead of inventing one', () => {
    for (const t of [undefined, null, 'yesterday', NaN, Infinity, {}]) {
      expect(parseFeedComment(PAGE, { ...base, created_time: t })!.createdTime).toBeNull()
    }
  })

  it.each([null, undefined, 0, 1, 'x', true, [], [base], () => base])(
    'never throws on hostile top-level input: %p',
    (value) => {
      expect(() => parseFeedComment(PAGE, value)).not.toThrow()
      expect(parseFeedComment(PAGE, value)).toBeNull()
    },
  )

  it('is pure — the same input yields an equal result and the input is not mutated', () => {
    const input = { ...base }
    const snapshot = JSON.stringify(input)

    const a = parseFeedComment(PAGE, input)
    const b = parseFeedComment(PAGE, input)

    expect(a).toEqual(b)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
