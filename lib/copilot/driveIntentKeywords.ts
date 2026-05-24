// All keyword lists + normalize/strip helpers used by the Drive intent layer.
// Kept in a separate module so driveIntent.ts can stay focused on detection
// orchestration without scrolling through the seed data.

const FINAL_MAP: Record<string, string> = {
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[ךםןףץ]/g, (c) => FINAL_MAP[c] ?? c)
}

const HE_PREFIX_LETTERS = new Set(['ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'ו'])

export function stripPrefix(word: string): string {
  // Only strip when the remainder is long enough to be meaningful. "הצעת"
  // (length 4) starts with ה but ה is a root letter, not a prefix — over-
  // stripping would produce "צעת" and break searches like "הצעת מחיר".
  if (word.length <= 4) return word
  if (HE_PREFIX_LETTERS.has(word[0])) return word.slice(1)
  return word
}

export const DRIVE_KEYWORDS_NORM = [
  // Hebrew content nouns (stay as search terms — they describe file kind).
  'חוזה',
  'חוזים',
  'הסכמ',
  'מסמכ',
  'הצעה',
  'הצעות',
  // English content nouns — bilingual parallels of the Hebrew set above.
  'contract',
  'contracts',
  'agreement',
  'agreements',
  'document',
  'documents',
  'proposal',
  'proposals',
  // Generic file/drive/folder words (also in STOPWORDS, so they're stripped
  // from the residual). Listed here so they trigger intent detection.
  'קובצ',
  'קבצימ',
  'דרייב',
  'גוגל דרייב',
  'pdf',
  'drive',
  'file',
  'files',
  'folder',
  'folders',
  'תיקייה',
  'תיקיות',
].map(normalize)

// Folder triggers the application/vnd.google-apps.folder mime filter.
export const FOLDER_KEYWORDS_NORM = ['folder', 'folders', 'תיקייה', 'תיקיות'].map(normalize)

export const ACTION_KEYWORDS_NORM = [
  'מצא',
  'חפש',
  'איפה',
  'תביא',
  'הבא',
  'שלוף',
  'תראה',
  'איזה',
  'רואה',
  'ראה',
  // Hebrew question / existence indicators — needed for "מה יש בדרייב" intent.
  // 2-char keywords match via substring; combined with the drive-keyword
  // requirement, false-positive risk is bounded.
  'מה',
  'יש',
  'see',
  'show',
  'look',
  'find',
  'search',
  'where',
  'what',
  'compare',
  'השווה',
  // Read / synthesis verbs — also Drive triggers; surfaced separately below
  // so the caller can decide to fetch content, not just metadata.
  'סכם',
  'סיכום',
  'קרא',
  'פתח',
  'נתח',
  'summarize',
  'summary',
  'read',
  'open',
  'analyze',
].map(normalize)

// Subset of action keywords that imply the user wants the *content* of a
// file, not just a list of matches. detectsDriveIntent still uses the full
// ACTION_KEYWORDS_NORM list; this subset only controls whether we ALSO
// fetch the top file's content and inject it as an attachment.
export const READ_ACTION_KEYWORDS_NORM = [
  'סכם',
  'סיכום',
  'קרא',
  'פתח',
  'נתח',
  'summarize',
  'summary',
  'read',
  'open',
  'analyze',
].map(normalize)

export const STOPWORDS_NORM = [
  // particles / pronouns / fillers
  'את', 'של', 'עם', 'יש', 'מה', 'איך', 'לי', 'לך', 'שלי', 'שלך',
  'הוא', 'היא', 'זה', 'זאת', 'או',
  'my', 'the', 'a', 'an', 'is', 'are', 'do', 'me', 'please',
  'you', 'called',
  // Hebrew interrogative / pronouns / structural words
  'האם', 'אתה', 'אתם', 'אתן', 'עליה', 'עליו', 'רשום',
  // common English prepositions
  'in', 'on', 'at', 'for', 'to', 'with', 'about', 'from',
  // Recency adjectives — should not become search terms ("show recent files"
  // should not search for files literally named "recent").
  'recent', 'latest', 'last', 'אחרון', 'אחרונה', 'אחרונים', 'אחרונות',
  // Drive control words — strip from search residual
  'דרייב', 'גוגל', 'גוגל דרייב', 'קובץ', 'קבצים', 'file', 'files', 'drive',
  // folder words — also turned into a mimeType filter via FOLDER_KEYWORDS_NORM
  'folder', 'folders', 'תיקייה', 'תיקיות',
].map(normalize)
