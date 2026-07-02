import ChannelIcon from './ChannelIcon'

/**
 * Shown in the workspace pane when no conversation is selected. Guides the user
 * to a next action (UX rule: no dead-end empty screens).
 */
export default function InboxEmptyState({ hasConversations }: { hasConversations: boolean }) {
  return (
    <div className='flex h-full flex-col items-center justify-center px-6 text-center'>
      <span className='flex size-14 items-center justify-center rounded-full bg-success-bg'>
        <ChannelIcon channel='whatsapp' className='size-6' />
      </span>
      <p className='mt-3 text-base font-medium text-gray-700'>
        {hasConversations ? 'בחר שיחה מהרשימה כדי להתחיל' : 'אין שיחות WhatsApp עדיין'}
      </p>
      <p className='mt-1 text-sm text-gray-500'>
        {hasConversations
          ? 'ההודעות, הניתוח והצעד הבא המומלץ יופיעו כאן.'
          : 'כשליד יכתוב בוואטסאפ, השיחה תופיע כאן אוטומטית.'}
      </p>
    </div>
  )
}
