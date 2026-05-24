// Attachment block builder + types — split out of leadAskQuestion.ts to
// keep the main prompt module under the 200-line ceiling. The block is
// JSON-serialized so the model can read structured per-file metadata
// alongside the "תוכן שנקרא" content for text attachments.

export type LeadQuestionAttachmentContext =
  | {
      kind: 'text'
      name: string
      mediaType: string
      size: number
      content: string
      partial: boolean
      originalChars: number
    }
  | {
      kind: 'image'
      name: string
      mediaType: string
      size: number
    }
  | {
      kind: 'unreadable'
      name: string
      mediaType: string
      size: number
      reason: 'unsupported-type' | 'extraction-failed' | 'empty-text' | 'total-limit'
    }

const UNREADABLE_REASON_HE: Record<Extract<LeadQuestionAttachmentContext, { kind: 'unreadable' }>['reason'], string> = {
  'unsupported-type': 'סוג הקובץ לא נתמך לקריאה',
  'extraction-failed': 'לא ניתן היה לחלץ תוכן מהקובץ',
  'empty-text': 'לא נמצא תוכן טקסטואלי קריא',
  'total-limit': 'לא נכלל בגלל מגבלת תוכן לשאלה אחת',
}

export function buildAttachmentsBlock(attachments: LeadQuestionAttachmentContext[]): string {
  if (attachments.length === 0) return ''

  const shape = attachments.map((attachment) => {
    const base = {
      'שם הקובץ': attachment.name,
      סוג: friendlyMediaType(attachment.mediaType),
      'גודל בבתים': attachment.size,
    }

    if (attachment.kind === 'text') {
      return {
        ...base,
        'מצב קריאה': attachment.partial ? 'חלקי' : 'מלא',
        'תווים במקור': attachment.originalChars,
        'תוכן שנקרא': attachment.content,
      }
    }

    if (attachment.kind === 'image') {
      return {
        ...base,
        'מצב קריאה': 'תמונה נשלחה לקריאה חזותית',
      }
    }

    return {
      ...base,
      'מצב קריאה': UNREADABLE_REASON_HE[attachment.reason],
    }
  })

  return `\n\nקבצים מצורפים לשאלה (JSON):\n${JSON.stringify(shape, null, 2)}`
}

function friendlyMediaType(mediaType: string): string {
  const t = mediaType.toLowerCase()
  if (t === 'application/pdf') return 'PDF'
  if (t.includes('spreadsheet') || t.includes('excel')) return 'Excel'
  if (t.startsWith('image/')) return 'תמונה'
  return 'קובץ'
}
