import { describe, expect, test } from 'vitest'
import { exportRows, toCsv } from '@/lib/i18n/exportRows'
import { flatten } from '@/lib/i18n/coverage'
import { CATALOGS } from '@/lib/i18n/messages'
import { REVIEWED } from '@/lib/i18n/review'

/** Minimal RFC 4180 reader, to prove the CSV parses back to the same rows. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = csv.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(cell), (cell = '')
    else if (c === '\r') continue
    else if (c === '\n') row.push(cell), rows.push(row), (row = []), (cell = '')
    else cell += c
  }
  return rows
}

describe('translation export for human review', () => {
  const rows = exportRows(CATALOGS)

  test('one row per string, and per plural form present in any locale', () => {
    const flat = flatten(CATALOGS.he)
    const strings = [...flat.values()].filter((v) => typeof v === 'string').length
    expect(rows.filter((r) => r.form === '').length).toBe(strings)
    expect(rows.filter((r) => r.key === 'shell.trialPill').map((r) => r.form)).toEqual(['zero', 'one', 'two', 'few', 'many', 'other'])
  })

  test('a form Hebrew does not use is still exported, with an empty Hebrew cell', () => {
    const few = rows.find((r) => r.key === 'shell.trialPill' && r.form === 'few')!
    expect(few.he).toBe('')
    expect(few.ar).toBe('PRO · تبقّت {count} أيام')
    expect(few.placeholders).toBe('count')
  })

  test('CSV round-trips, including commas, quotes and RTL text', () => {
    const parsed = parseCsv(toCsv(rows))
    expect(parsed[0]).toEqual(['key', 'namespace', 'form', 'placeholders', 'he', 'en', 'ar', 'enReviewed', 'arReviewed'])
    expect(parsed.length - 1).toBe(rows.length)
    const back = parsed.slice(1).map((r) => r[0] + '#' + r[2] + '=' + r[5])
    expect(back).toEqual(rows.map((r) => r.key + '#' + r.form + '=' + r.en))
    expect(toCsv([{ ...rows[0], en: 'a, "b"\nc' }])).toContain('"a, ""b""\nc"')
  })

  test('starts with a UTF-8 BOM so spreadsheets read Hebrew/Arabic', () => {
    expect(toCsv(rows).charCodeAt(0)).toBe(0xfeff)
  })

  test('review columns reflect the sign-off registry — nothing is signed off yet', () => {
    expect(REVIEWED).toEqual({ en: {}, ar: {} })
    expect(rows.every((r) => r.enReviewed === '' && r.arReviewed === '')).toBe(true)
  })
})
