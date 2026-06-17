import { listConversationMessages } from '@/db/inboxMessages'
import WhatsappConversation from '@/components/summary/WhatsappConversation'
import ConversationRefreshPoller from '@/components/summary/ConversationRefreshPoller'
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

  return (
    <div className='p-2'>
      <InboxReadMarker conversationId={conversationId} />
      <ConversationRefreshPoller />
      <OperatorTake conversationId={conversationId} />
      <WhatsappConversation messages={messages} leadId={leadId} />
    </div>
  )
}
