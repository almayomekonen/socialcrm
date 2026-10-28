import { describe, expect, test } from 'vitest'
import { checkCatalogs, flatten, unusedKeys } from '@/lib/i18n/coverage'
import { CATALOGS } from '@/lib/i18n/messages'
import { readSources } from '@/scripts/i18n-check'

describe('translation coverage', () => {
  test('every catalog is complete, well-formed, and actually translated', () => {
    expect(checkCatalogs(CATALOGS)).toEqual([])
  })

  test('every key is used somewhere in the code', () => {
    expect(unusedKeys(CATALOGS.he, readSources())).toEqual([])
  })

  test('the checker catches the defects it exists for', () => {
    const broken = structuredClone(CATALOGS) as any
    delete broken.en.shell.nav.leads
    broken.ar.shell.help = ''
    broken.en.language.useAgencyDefault = 'Business default'
    broken.ar.shell.nav.today = CATALOGS.he.shell.nav.today
    delete broken.ar.shell.trialPill.few
    broken.en.shell.extra = 'x'
    const kinds = checkCatalogs(broken).map((i) => `${i.locale}:${i.kind}:${i.key}`)
    expect(kinds).toEqual(
      expect.arrayContaining([
        'en:missing:shell.nav.leads',
        'ar:empty:shell.help',
        'en:placeholder:language.useAgencyDefault',
        'ar:untranslated:shell.nav.today',
        'ar:plural:shell.trialPill',
        'en:extra:shell.extra',
      ]),
    )
  })

  test('flatten treats plural objects as one leaf', () => {
    expect(flatten(CATALOGS.he).get('shell.trialPill')).toEqual(CATALOGS.he.shell.trialPill)
  })
})
