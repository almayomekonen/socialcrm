import Icon from '@/lib/Icon'
import type { InboxMessageAttachment } from '@/db/inboxMessages'
import { attachmentHref, fileKindLabel, UNNAMED_ATTACHMENT_LABEL } from '@/lib/inbox/attachmentDisplay'

/**
 * Inbound WhatsApp file, rendered inside the existing message bubble on both
 * desktop and mobile. One implementation so the two surfaces stay identical.
 *
 * The link points at the authenticated proxy route — never at Meta — and is
 * labelled with the filename so the control has a real accessible name rather
 * than a bare "פתח".
 */
export default function WhatsappAttachment({
  messageId,
  attachment,
}: {
  messageId: number
  attachment: InboxMessageAttachment
}) {
  const name = attachment.filename ?? UNNAMED_ATTACHMENT_LABEL
  const kind = fileKindLabel(attachment.mimeType)

  return (
    <div className='flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5'>
      <Icon name='file' className='size-4 shrink-0 bg-gray-500' />
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm leading-tight text-gray-800' title={name}>
          {name}
        </p>
        {kind && <p className='text-[11px] leading-tight text-gray-500'>{kind}</p>}
      </div>
      <a
        href={attachmentHref(messageId)}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={`פתח את הקובץ ${name}`}
        className='shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        פתח
      </a>
    </div>
  )
}
