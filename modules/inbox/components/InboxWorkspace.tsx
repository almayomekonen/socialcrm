import { listConversationMessages } from '@/db/inboxMessages'
import InboxThread from './InboxThread'
import { SUPPORTED_WORKSPACE_CHANNELS, channelLabel } from '@/modules/inbox/channels'
import InboxReadMarker from './InboxReadMarker'
import OperatorTake from './OperatorTake'

export default async function InboxWorkspace({
  conversationId,
  leadId,
  channel,
  displayName = null,
  leadStatus = null,
  customerWaId = null,
}: {
  conversationId: number
  leadId: number
  channel: string
  displayName?: string | null
  leadStatus?: string | null
  customerWaId?: string | null
}) {
  if (!SUPPORTED_WORKSPACE_CHANNELS.has(channel)) {
    return (
      <div className='flex h-full items-center justify-center text-center text-sm text-gray-400'>
        שיחות {channelLabel(channel)} עדיין לא נתמכות כאן.
      </div>
    )
  }

  const messages = await listConversationMessages(conversationId)
  const latestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <InboxReadMarker conversationId={conversationId} latestMessageId={latestMessageId} />
      <InboxThread
        conversationId={conversationId}
        leadId={leadId}
        initialMessages={messages}
        displayName={displayName}
        leadStatus={leadStatus}
        customerWaId={customerWaId}
        banner={<OperatorTake conversationId={conversationId} />}
      />
    </div>
  )
}
