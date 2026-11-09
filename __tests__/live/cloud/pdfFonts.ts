/** `pdffonts` output as data, and the rule every quote PDF must meet. Pure. */

export type PdfFont = { name: string; type: string; embedded: boolean }

/** The dashed rule gives the column widths, so a font name containing a space still parses. */
export function parsePdfFonts(stdout: string): PdfFont[] {
  const lines = stdout.split('\n')
  const rule = lines.findIndex((l) => /^-+( -+)+\s*$/.test(l))
  if (rule < 0) throw new Error('pdffonts: no table in the output')
  const columns: [number, number][] = []
  for (const m of lines[rule].matchAll(/-+/g)) columns.push([m.index, m.index + m[0].length])
  const header = lines[rule - 1]
  const at = (label: string) => columns.findIndex(([from, to]) => header.slice(from, to).trim() === label)
  const [name, type, emb] = [at('name'), at('type'), at('emb')]
  if (name < 0 || type < 0 || emb < 0) throw new Error('pdffonts: unexpected columns')
  const cell = (l: string, i: number) => l.slice(columns[i][0], columns[i][1]).trim()
  return lines
    .slice(rule + 1)
    .filter((l) => l.trim())
    .map((l) => ({ name: cell(l, name), type: cell(l, type), embedded: cell(l, emb) === 'yes' }))
}

export function assertHebrewFontsEmbedded(fonts: readonly PdfFont[]): void {
  if (!fonts.length) throw new Error('the PDF lists no fonts')
  if (!fonts.some((f) => f.name.includes('NotoSansHebrew'))) throw new Error(`NotoSansHebrew is missing: ${fonts.map((f) => f.name).join(', ')}`)
  const notEmbedded = fonts.filter((f) => !f.embedded)
  if (notEmbedded.length) throw new Error(`not embedded: ${notEmbedded.map((f) => f.name).join(', ')}`)
}
