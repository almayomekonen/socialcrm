import { readFileSync } from 'node:fs'
import path from 'node:path'

// Local NotoSansHebrew TTF files inlined as base64 data URIs. Loading the
// font from a CDN at render time made the Chromium pipeline depend on
// document.fonts.ready, which (a) needs a network round-trip from inside
// the Lambda and (b) sometimes never resolves under chromium-min's
// single-process mode. Inlining avoids both problems and is fully
// deterministic.
//
// Both files are read ONCE per Node process at module-eval time. They're
// small (<70KB each), so the resulting in-memory data URI is acceptable
// for inclusion in every rendered HTML document.

function readFontDataUri(filename: string): string {
  const filePath = path.join(process.cwd(), 'public', 'fonts', filename)
  const bytes = readFileSync(filePath)
  return `data:font/ttf;base64,${bytes.toString('base64')}`
}

export const NOTO_HEBREW_REGULAR_URI = readFontDataUri('NotoSansHebrew-Regular.ttf')
export const NOTO_HEBREW_BOLD_URI = readFontDataUri('NotoSansHebrew-Bold.ttf')

export function fontFaceBlock(): string {
  return `
@font-face {
  font-family: 'Noto Sans Hebrew';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url('${NOTO_HEBREW_REGULAR_URI}') format('truetype');
}
@font-face {
  font-family: 'Noto Sans Hebrew';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url('${NOTO_HEBREW_BOLD_URI}') format('truetype');
}
`.trim()
}
