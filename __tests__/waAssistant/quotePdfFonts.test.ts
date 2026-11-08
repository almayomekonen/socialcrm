import { describe, expect, it } from 'vitest'
import { assertHebrewFontsEmbedded, parsePdfFonts } from '../live/cloud/pdfFonts'
import { filenameFrom } from '../live/cloud/helpers'

/** The rule the cloud harness applies to every PDF. If it can be fooled, so can the harness. */

const HEAD = ['name                                 type              encoding         emb sub uni object ID', '------------------------------------ ----------------- ---------------- --- --- --- ---------']
const row = (name: string, emb = 'yes') => `${name.padEnd(36)} CID TrueType      Identity-H       ${emb} yes yes     12  0`
const table = (...rows: string[]) => [...HEAD, ...rows, ''].join('\n')

describe('parsePdfFonts', () => {
  it('reads each row, with a name containing a space', () => {
    expect(parsePdfFonts(table(row('AAAAAA+NotoSansHebrew-Regular'), row('Some Font Name', 'no')))).toEqual([
      { name: 'AAAAAA+NotoSansHebrew-Regular', type: 'CID TrueType', embedded: true },
      { name: 'Some Font Name', type: 'CID TrueType', embedded: false },
    ])
  })
  it('refuses output that is not the table', () => expect(() => parsePdfFonts('Syntax Error')).toThrow('no table'))
})

describe('assertHebrewFontsEmbedded', () => {
  const fonts = (...rows: string[]) => parsePdfFonts(table(...rows))
  it('passes when NotoSansHebrew is there and every font is embedded', () => expect(() => assertHebrewFontsEmbedded(fonts(row('AAAAAA+NotoSansHebrew-Bold'), row('BBBBBB+Arial')))).not.toThrow())
  it('fails without NotoSansHebrew', () => expect(() => assertHebrewFontsEmbedded(fonts(row('BBBBBB+Arial')))).toThrow('NotoSansHebrew is missing'))
  it('fails when any font is not embedded, even beside the right one', () => expect(() => assertHebrewFontsEmbedded(fonts(row('AAAAAA+NotoSansHebrew-Bold'), row('Helvetica', 'no')))).toThrow('not embedded: Helvetica'))
  it('fails on a PDF with no fonts', () => expect(() => assertHebrewFontsEmbedded(fonts())).toThrow('lists no fonts'))
})

describe('filenameFrom', () => {
  it('returns the decoded Hebrew name and the ASCII fallback', () => {
    expect(filenameFrom(`attachment; filename="Quote-1-___.pdf"; filename*=UTF-8''Quote-1-${encodeURIComponent('דני')}.pdf`)).toEqual({ utf8: 'Quote-1-דני.pdf', ascii: 'Quote-1-___.pdf' })
  })
  it('refuses a header with either name missing', () => {
    expect(() => filenameFrom('attachment; filename="a.pdf"')).toThrow()
    expect(() => filenameFrom(null)).toThrow()
  })
})
