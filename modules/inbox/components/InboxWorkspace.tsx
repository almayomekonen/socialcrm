import { listConversationMessages } from '@/db/inboxMessages'
import { getUser } from '@/db/auth'
import { loadWhatsappComposerContext } from '@/lib/inbox/whatsappComposerContext'
import InboxThread from './InboxThread'
import { SUPPORTED_WORKSPACE_CHANNELS, channelLabel } from '@/modules/inbox/channels'
import InboxReadMarker from './InboxReadMarker'
import OperatorTake from './OperatorTake'
import AgentOwnership from './AgentOwnership'

export default async function InboxWorkspace({
  conversationId,
  leadId,
  isPersonal = false,
  channel,
  displayName = null,
  leadStatus = null,
  customerWaId = null,
}: {
  conversationId: number
  leadId: number | null
  isPersonal?: boolean
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

  const user = await getUser()
  const [messages, composerFacts] = await Promise.all([
    listConversationMessages(conversationId),
    user?.agencyId
      ? loadWhatsappComposerContext(user.agencyId, conversationId, { role: user.role })
      : Promise.resolve(null),
  ])
  const latestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <InboxReadMarker conversationId={conversationId} latestMessageId={latestMessageId} />
      <InboxThread
        conversationId={conversationId}
        leadId={leadId}
        isPersonal={isPersonal}
        initialMessages={messages}
        displayName={displayName}
        leadStatus={leadStatus}
        customerWaId={customerWaId}
        banner={
          <>
            <AgentOwnership conversationId={conversationId} />
            <OperatorTake conversationId={conversationId} />
          </>
        }
        composerFacts={composerFacts}
      />
    </div>
  )
}
