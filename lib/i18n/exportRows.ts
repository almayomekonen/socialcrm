import { flatten } from './coverage'
import { REVIEWED, type Namespace } from './review'
import type { Messages } from './translate'

/**
 * One row per translatable string, for human review. A plural message becomes
 * one row per CLDR category present in ANY locale (`shell.trialPill#few`), so
 * a reviewer sees every form Arabic needs even where Hebrew has none.
 */
export type ExportRow = {
  key: string
  namespace: string
  form: string
  placeholders: string
  he: string
  en: string
  ar: string
  enReviewed: string
  arReviewed: string
}

type Catalogs = { he: Messages; en: Messages; ar: Messages }

function placeholdersOf(texts: string[]): string {
  const names = new Set<string>()
  for (const text of texts) for (const m of text.matchAll(/\{(\w+)\}/g)) names.add(m[1])
  return [...names].sort().join(' ')
}

const PLURAL_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other']

export function exportRows(catalogs: Catalogs): ExportRow[] {
  const flat = { he: flatten(catalogs.he), en: flatten(catalogs.en), ar: flatten(catalogs.ar) }
  const rows: ExportRow[] = []
  for (const [key, heLeaf] of flat.he) {
    const namespace = key.split('.')[0] as Namespace
    const signed = (loc: 'en' | 'ar') => {
      const s = REVIEWED[loc][namespace]
      return s ? `${s.reviewer} ${s.date}` : ''
    }
    const leaves = { he: heLeaf, en: flat.en.get(key) ?? '', ar: flat.ar.get(key) ?? '' }
    if (typeof heLeaf === 'string') {
      const texts = { he: leaves.he as string, en: (leaves.en as string) ?? '', ar: (leaves.ar as string) ?? '' }
      rows.push({ key, namespace, form: '', placeholders: placeholdersOf(Object.values(texts)), ...texts, enReviewed: signed('en'), arReviewed: signed('ar') })
      continue
    }
    const forms = new Set<string>()
    for (const leaf of Object.values(leaves)) if (leaf && typeof leaf === 'object') Object.keys(leaf).forEach((f) => forms.add(f))
    for (const form of PLURAL_ORDER.filter((f) => forms.has(f))) {
      const pick = (leaf: unknown) => (leaf && typeof leaf === 'object' ? ((leaf as Record<string, string>)[form] ?? '') : '')
      const texts = { he: pick(leaves.he), en: pick(leaves.en), ar: pick(leaves.ar) }
      rows.push({ key, namespace, form, placeholders: placeholdersOf(Object.values(texts)), ...texts, enReviewed: signed('en'), arReviewed: signed('ar') })
    }
  }
  return rows
}

const COLUMNS: (keyof ExportRow)[] = ['key', 'namespace', 'form', 'placeholders', 'he', 'en', 'ar', 'enReviewed', 'arReviewed']

/** RFC 4180 CSV with a UTF-8 BOM so spreadsheet apps open Hebrew/Arabic correctly. */
export function toCsv(rows: ExportRow[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return '﻿' + [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n'
}
