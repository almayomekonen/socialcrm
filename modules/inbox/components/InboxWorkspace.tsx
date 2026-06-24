import { listConversationMessages } from '@/db/inboxMessages'
import InboxThread from './InboxThread'
import { SUPPORTED_WORKSPACE_CHANNELS, channelLabel } from '@/modules/inbox/channels'
import InboxReadMarker from './InboxReadMarker'
import OperatorTake from './OperatorTake'

export default async function InboxWorkspace({
  conversationId,
  leadId,
  channel,
}: {
  conversationId: number
  leadId: number
  channel: string
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
    <div className='p-2'>
      <InboxReadMarker conversationId={conversationId} latestMessageId={latestMessageId} />
      <OperatorTake conversationId={conversationId} />
      <InboxThread conversationId={conversationId} leadId={leadId} initialMessages={messages} />
    </div>
  )
}
