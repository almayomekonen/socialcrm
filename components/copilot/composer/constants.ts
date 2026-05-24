import type { IconNames } from '@/lib/Icon'
import type { LensId } from '@/lib/ai/prompts/leadAskQuestion'
import type { PredefinedCopilotActionId } from '@/lib/copilot/copilotResponse'
import type { ExtractedAttachment } from '@/lib/copilot/clientExtract'

export const MAX_TEXTAREA_HEIGHT = 160

export const UPLOAD_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx'

export type AttachmentItem = {
  id: string
  file: File
  status: 'reading' | 'ready' | 'partial' | 'unreadable' | 'uploading' | 'error'
  extracted?: ExtractedAttachment
}

export const LENS_LABEL: Record<LensId, string> = {
  conversations: 'שיחות אחרונות',
  tasks: 'משימות',
  notes: 'הערות',
  files: 'קבצים',
}

export const LENS_ICON: Record<LensId, IconNames> = {
  conversations: 'comment',
  tasks: 'list-check',
  notes: 'note-sticky',
  files: 'paperclip',
}

export const ATTACHMENT_STATUS_LABEL: Record<AttachmentItem['status'], string> = {
  reading: 'קורא',
  ready: '',
  partial: 'חלקי',
  unreadable: 'לא נקרא',
  uploading: 'מעלה',
  error: 'שגיאה',
}

export function extractionStatus(extracted: ExtractedAttachment): AttachmentItem['status'] {
  if (extracted.kind === 'text') return extracted.truncated ? 'partial' : 'ready'
  if (extracted.kind === 'image') return 'ready'
  return 'unreadable'
}

export function isKnownActionId(id: string): id is PredefinedCopilotActionId {
  return id === 'draft-followup-message' || id === 'next-best-step'
}

export const POP_KEYFRAMES = `
  @keyframes cp-pop-in {
    from { opacity: 0; transform: translateY(4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    [role="menu"] { animation: none !important; }
  }
`
