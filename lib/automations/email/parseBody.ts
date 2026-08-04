/**
 * The authored body is one plain-text blob. This turns it into typed BLOCKS, so
 * the renderer styles structure instead of guessing at it.
 *
 * Before this, the blob was split on blank lines and every piece was styled
 * identically, with single newlines surviving only because of a
 * `white-space:pre-line` declaration — which Outlook desktop and Outlook.com
 * drop, collapsing a three-line signature into one line. Line breaks are now
 * MARKUP, and the sign-off is a block with its own typography.
 *
 * Deliberately closed: no Markdown, no inline HTML, no free-form formatting. The
 * customer writes plain text and the shell makes it look premium — that is the
 * agreed content model.
 */

export type ContentBlock =
  | { kind: 'greeting'; lines: string[] }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'signature'; lines: string[] }

/**
 * Hebrew and English sign-off openers. Matching one at the START of the LAST
 * block is what promotes it to a signature — a mid-body "בברכה" is just words.
 */
const SIGNOFF_OPENERS = [
  'בברכה',
  'בהצלחה',
  'תודה',
  'תודה רבה',
  'נתראה',
  'להתראות',
  'שלכם',
  'שלך',
  'מאחלים',
  'כל טוב',
  'יום טוב',
  'best',
  'best regards',
  'regards',
  'kind regards',
  'warmly',
  'sincerely',
  'thanks',
  'thank you',
  'cheers',
  'yours',
] as const

/** A sign-off opener, optionally followed by a comma — and nothing else. */
function isSignoffOpener(line: string): boolean {
  const normalised = line.trim().replace(/[,،.!]+$/, '').toLowerCase()
  return SIGNOFF_OPENERS.includes(normalised as (typeof SIGNOFF_OPENERS)[number])
}

/**
 * A greeting is the first block when it is short and opens with a salutation.
 * Anything else keeps paragraph styling — a body that dives straight into
 * content should not have its first sentence enlarged.
 */
const GREETING_OPENERS = ['שלום', 'היי', 'הי', 'אהלן', 'בוקר טוב', 'ערב טוב', 'hi', 'hello', 'hey', 'dear'] as const

function isGreeting(lines: string[]): boolean {
  if (lines.length !== 1) return false
  const first = lines[0].trim()
  if (first.length > 60) return false
  const lowered = first.toLowerCase()
  return GREETING_OPENERS.some((opener) => lowered === opener || lowered.startsWith(`${opener} `) || lowered.startsWith(`${opener},`))
}

/**
 * Split the body into blocks.
 *
 * Blank lines separate blocks; single newlines are LINES within a block and are
 * preserved as real breaks by the renderer. CRLF is normalised first, so content
 * arriving from an import or an API does not silently become one giant block.
 */
export function parseBody(body: string): ContentBlock[] {
  const groups = body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((group) =>
      group
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0)

  if (groups.length === 0) return []

  return groups.map((lines, index) => {
    const isLast = index === groups.length - 1
    // A trailing block that opens with a sign-off is the signature. Requiring it
    // to be last is what stops "תודה שפנית אלינו" mid-body from being treated
    // as one.
    if (isLast && index > 0 && isSignoffOpener(lines[0])) return { kind: 'signature' as const, lines }
    if (index === 0 && isGreeting(lines)) return { kind: 'greeting' as const, lines }
    return { kind: 'paragraph' as const, lines }
  })
}

/** The block's text, for direction resolution and the plain-text alternative. */
export const blockText = (block: ContentBlock): string => block.lines.join('\n')
