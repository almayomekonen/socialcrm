import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { db } from '@/config/db'
import { getUiLocalePrefs, setAgencyUiLocale, setUserUiLocale } from '@/db/uiLocale'
import { resolveUiLocale } from '@/lib/i18n/resolve'

/**
 * Real database (baseline + every migration, built by globalSetup), so this
 * also proves 20261028120000_ui_locale applies and leaves existing rows NULL.
 */
let agencyA: number, agencyB: number, userA1: number, userA2: number, userB: number

const idOf = (row: any) => (typeof row === 'number' ? row : row.id)

beforeAll(async () => {
  agencyA = idOf((await db('agencies').insert({ name: '__i18n_A__' }).returning('id'))[0])
  agencyB = idOf((await db('agencies').insert({ name: '__i18n_B__' }).returning('id'))[0])
  userA1 = idOf((await db('users').insert({ firstName: 'A1', role: 'ADMIN', agencyId: agencyA }).returning('id'))[0])
  userA2 = idOf((await db('users').insert({ firstName: 'A2', role: 'AGNT', agencyId: agencyA }).returning('id'))[0])
  userB = idOf((await db('users').insert({ firstName: 'B', role: 'AGNT', agencyId: agencyB }).returning('id'))[0])
})

afterAll(async () => {
  await db('users').whereIn('id', [userA1, userA2, userB]).delete()
  await db('agencies').whereIn('id', [agencyA, agencyB]).delete()
})

async function effective(userId: number, agencyId: number) {
  return resolveUiLocale({ enabled: true, ...(await getUiLocalePrefs(userId, agencyId)) })
}

describe('ui locale persistence', () => {
  test('new rows default to NULL — Hebrew, nothing changed for existing accounts', async () => {
    expect(await getUiLocalePrefs(userA1, agencyA)).toEqual({ userLocale: null, agencyLocale: null })
    expect(await effective(userA1, agencyA)).toEqual({ locale: 'he', source: 'default' })
    const billing = await db('agencies').where({ id: agencyA }).first('locale')
    expect(billing.locale).toBe('he')
  })

  test('agency default reaches users without a personal choice, and only that agency', async () => {
    await setAgencyUiLocale(agencyA, 'en')
    expect(await effective(userA2, agencyA)).toEqual({ locale: 'en', source: 'agency' })
    expect(await effective(userB, agencyB)).toEqual({ locale: 'he', source: 'default' })
  })

  test('changing the agency default never overwrites a personal choice', async () => {
    await setUserUiLocale(userA1, agencyA, 'ar')
    await setAgencyUiLocale(agencyA, 'he')
    expect(await effective(userA1, agencyA)).toEqual({ locale: 'ar', source: 'user' })
    expect(await effective(userA2, agencyA)).toEqual({ locale: 'he', source: 'agency' })
  })

  test('the interface language never touches the billing locale', async () => {
    await setAgencyUiLocale(agencyA, 'en')
    const row = await db('agencies').where({ id: agencyA }).first('locale', 'uiLocale')
    expect(row).toEqual({ locale: 'he', uiLocale: 'en' })
  })

  test('a user write scoped to the wrong agency changes nothing', async () => {
    const changed = await setUserUiLocale(userB, agencyA, 'en')
    expect(changed).toBe(0)
    expect((await getUiLocalePrefs(userB, agencyB)).userLocale).toBeNull()
  })

  test('reading with a mismatched agency returns no other-agency data', async () => {
    expect(await getUiLocalePrefs(userB, agencyA)).toEqual({ userLocale: null, agencyLocale: null })
  })

  test('clearing returns to the agency default (survives a fresh read = across sessions)', async () => {
    await setUserUiLocale(userA1, agencyA, null)
    expect(await effective(userA1, agencyA)).toEqual({ locale: 'en', source: 'agency' })
  })
})
