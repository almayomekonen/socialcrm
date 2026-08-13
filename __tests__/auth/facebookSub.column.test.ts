import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'

const TAG = '__fbsub_' + Date.now() + '_'

describe.skipIf(process.env.VITEST_NO_DB === '1')('users.facebookSub', () => {
  const emails: string[] = []

  afterAll(async () => {
    if (emails.length) await db('users').whereIn('email', emails).delete()
  })

  it('is nullable unique — two NULLs are allowed, the same Facebook id is not', async () => {
    const a = TAG + 'a@example.com'
    const b = TAG + 'b@example.com'
    const c = TAG + 'c@example.com'
    const d = TAG + 'd@example.com'
    emails.push(a, b, c, d)

    await db('users').insert({ email: a, name: 'A', facebookSub: '1000444' })
    await db('users').insert({ email: b, name: 'B' })
    await db('users').insert({ email: c, name: 'C' })

    await expect(db('users').insert({ email: d, name: 'D', facebookSub: '1000444' })).rejects.toMatchObject({
      code: '23505',
    })
  })
})
