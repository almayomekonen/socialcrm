import {
  ACTION_KEYWORDS_NORM,
  FOLDER_KEYWORDS_NORM,
  STOPWORDS_NORM,
  normalize,
} from './driveIntentKeywords'
import { tokenize } from './driveIntentTokenize'

export type DriveQuery = { q: string; mode: 'specific' | 'generic' }

const PDF_MIME_FILTER = "mimeType='application/pdf'"
const FOLDER_MIME_FILTER = "mimeType='application/vnd.google-apps.folder'"

/**
 * Build a Drive `q` expression in one of two modes:
 *
 *   specific — at least one search-worthy noun survived stopword/action
 *     stripping. AND-joined `name contains` per token plus optional mime
 *     filters (PDF, folder).
 *   generic — no specific nouns; the question was a pure-browse prompt
 *     ("show me what's in Drive"). The returned `q` is empty (driveClient
 *     defaults to `trashed = false`) or just a mime filter when the user
 *     specifically asked for PDFs / folders.
 */
export function buildDriveQuery(question: string): DriveQuery {
  const qNorm = normalize(question)
  const wantsPdf = qNorm.includes('pdf')
  const wantsFolder = FOLDER_KEYWORDS_NORM.some((kw) => qNorm.includes(kw))

  const tokens = tokenize(question)

  const residual: string[] = []
  for (const { stripped, normalized: n } of tokens) {
    if (STOPWORDS_NORM.includes(n)) continue
    if (ACTION_KEYWORDS_NORM.some((kw) => n.includes(kw))) continue
    if (n === 'pdf') continue
    residual.push(stripped)
  }

  const seen = new Set<string>()
  const uniq: string[] = []
  for (const t of residual) {
    const key = normalize(t)
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(t)
  }

  const mimeFilters: string[] = []
  if (wantsPdf) mimeFilters.push(PDF_MIME_FILTER)
  if (wantsFolder) mimeFilters.push(FOLDER_MIME_FILTER)

  if (uniq.length === 0) {
    return { q: mimeFilters.join(' and '), mode: 'generic' }
  }

  const parts = uniq.map((t) => `(name contains '${escapeSingleQuotes(t)}')`)
  parts.push(...mimeFilters)
  return { q: parts.join(' and '), mode: 'specific' }
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "\\'")
}
