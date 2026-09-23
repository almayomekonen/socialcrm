import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import type { MessengerConversationEvent, MessengerConversationListItem, MessengerMessage } from '../types'
import MessengerAvatar from './MessengerAvatar'
import MessengerComposer from './MessengerComposer'
import MessengerLeadActions from './MessengerLeadActions'
import MessengerMessageList from './MessengerMessageList'
import MessengerReadMarker from './MessengerReadMarker'

/**
 * Messenger conversation workspace: header with lead association, the message
 * history, and the composer. Bubble anatomy follows WhatsappConversation.
 * `window` is decided on the server and passed in.
 *
 * A thin orchestrator: the history (and its "load earlier" paging) lives in
 * MessengerMessageList, one bubble in MessengerBubble.
 */
export default function MessengerThread({
  conversation,
  messages,
  hasMoreMessages,
  events,
  windowOpen,
  windowHint,
  canSend,
  permissionPrompt,
}: {
  conversation: MessengerConversationListItem
  /** First page, oldest-first. */
  messages: MessengerMessage[]
  hasMoreMessages: boolean
  /** Postbacks, referrals and reactions, oldest-first. */
  events: MessengerConversationEvent[]
  windowOpen: boolean
  windowHint: string | null
  /** False when the Page's grant lacks pages_messaging — then `permissionPrompt` explains. */
  canSend: boolean
  permissionPrompt: React.ReactNode
}) {
  const name = conversation.leadName ?? conversation.customerName ?? 'פונה מ-Messenger'

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col'>
      <MessengerReadMarker conversationId={conversation.id} latestMessageId={messages.at(-1)?.id ?? null} />

      <header className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <MessengerAvatar name={name} picUrl={conversation.profilePicUrl} size='md' />
          <div className='min-w-0'>
            <p className='truncate text-base font-semibold text-gray-900'>{name}</p>
            <p className='inline-flex items-center gap-1 text-xs text-gray-500'>
              <ChannelIcon channel='messenger' className='size-3' />
              Messenger
            </p>
          </div>
        </div>
        <MessengerLeadActions conversationId={conversation.id} leadId={conversation.leadId} leadName={conversation.leadName} />
      </header>

      <MessengerMessageList
        conversationId={conversation.id}
        initial={messages}
        hasMoreInitially={hasMoreMessages}
        events={events}
      />

      <div className='shrink-0 border-t border-gray-100 bg-white px-3 py-2.5'>
        {canSend ? (
          <MessengerComposer conversationId={conversation.id} windowOpen={windowOpen} windowHint={windowHint} />
        ) : (
          permissionPrompt
        )}
      </div>
    </div>
  )
}
