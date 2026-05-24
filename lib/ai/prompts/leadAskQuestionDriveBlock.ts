import type { DriveSearchResult } from '@/lib/integrations/google/driveClient'

// Cap on generic / recent-files mode. Avoids floods of bullets in the chat.
const MAX_GENERIC_RESULTS = 5

/**
 * Renders the "נמצאו ב-Google Drive" block injected into the user message
 * when Drive search returned results. Plain bullet list — name only, one
 * line per file. URL is deliberately omitted (overflows the chat bubble);
 * date/icon/CTA are also omitted (would add noise without clickability in
 * the current AnswerBody renderer).
 *
 * The U+200E (LRM) before each filename pins the English filename's
 * direction to LTR inside the RTL paragraph — without it, Unicode bidi
 * reorders the bullet to the visual right of the filename.
 */
export function buildDriveResultsBlock(
  results: DriveSearchResult[] | null,
  mode?: 'specific' | 'generic',
): string {
  if (!results || results.length === 0) return ''

  const total = results.length
  const isGeneric = mode === 'generic'
  const shown = isGeneric ? results.slice(0, MAX_GENERIC_RESULTS) : results
  const truncated = isGeneric && total > shown.length

  const header = isGeneric
    ? truncated
      ? `נמצאו ב-Google Drive (חיפוש כללי, ${total} תוצאות, מציג ${shown.length} ראשונים):`
      : `נמצאו ב-Google Drive (חיפוש כללי, ${total} תוצאות):`
    : `נמצאו ב-Google Drive (${total} תוצאות):`

  const lines = shown.map((r) => `• ‎${r.name}`)
  return `\n\n${header}\n${lines.join('\n')}`
}
