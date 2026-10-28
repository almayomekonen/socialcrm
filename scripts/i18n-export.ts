/**
 * `pnpm i18n:export <out.csv>` — every UI string in he/en/ar, one row per
 * string (and per plural form), for native-language review. Writes only the
 * file it is given; the path is required so a review export never lands in the
 * repository by accident.
 */
import fs from 'node:fs'
import path from 'node:path'
import { CATALOGS } from '../lib/i18n/messages'
import { exportRows, toCsv } from '../lib/i18n/exportRows'

const target = process.argv[2]
if (!target) {
  console.error('usage: pnpm i18n:export <out.csv>')
  process.exit(1)
}
const out = path.resolve(target)
const rows = exportRows(CATALOGS)
fs.writeFileSync(out, toCsv(rows), 'utf8')
console.log(`i18n: wrote ${rows.length} rows to ${out}`)
