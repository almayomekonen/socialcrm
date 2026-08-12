/**
 * Live DB CHECK for clients.createOrigin.
 * Skipped under VITEST_NO_DB=1 (mocked suites cover writers).
 */

import { afterAll, describe, expect, it } from 'vitest'

describe.skipIf(process.env.VITEST_NO_DB === '1')('DB CHECK rejects invalid createOrigin', () => {
  let db: typeof import('@/config/db').db

  afterAll(async () => {
    if (db) await db.destroy()
  })

  it('rejects a value outside the allowed set', async () => {
    ;({ db } = await import('@/config/db'))
    const agency = await db('agencies').select('id').first()
    if (!agency?.id) return

    await expect(
      db('clients').insert({
        firstName: '__createOrigin_check__',
        agencyId: agency.id,
        lead: true,
        createOrigin: 'webhook',
      }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('allows NULL createOrigin (legacy rows remain NULL)', async () => {
    ;({ db } = await import('@/config/db'))
    const agency = await db('agencies').select('id').first()
    if (!agency?.id) return

    const [row] = await db('clients')
      .insert({
        firstName: '__createOrigin_null__',
        agencyId: agency.id,
        lead: true,
        createOrigin: null,
      })
      .returning(['id', 'createOrigin'])
    expect(row.createOrigin).toBeNull()
    await db('clients').where({ id: row.id }).delete()
  })
})
