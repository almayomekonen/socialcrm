'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import LeadPicker from '@/components/billing/lead-picker/LeadPicker'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { createLeadFromMessengerConversation, linkMessengerConversationToLead, type MessengerLeadResult } from '../leadActions'

const FAILURE_COPY: Record<string, string> = {
  not_enabled: 'Messenger אינו זמין בחשבון הזה',
  not_found: 'השיחה או הליד לא נמצאו',
  quota_exceeded: 'הגעת למכסת הלידים בחבילה הנוכחית',
  create_failed: 'לא ניתן ליצור ליד מהשיחה. נסה שוב.',
}

/**
 * Lead association for a Messenger conversation: open the linked ליד, or
 * create one, or attach an existing one through the shared LeadPicker (the
 * same picker the calendar uses — its search is permission-scoped server-side).
 */
export default function MessengerLeadActions({
  conversationId,
  leadId,
  leadName,
}: {
  conversationId: number
  leadId: number | null
  leadName: string | null
}) {
  const router = useRouter()
  const { loading, run, accessDenied } = useAction()

  if (leadId) {
    return (
      <Link href={`/clients/${leadId}/summary`} className='text-sm text-primary underline underline-offset-2'>
        {leadName ? `פתח את הליד: ${leadName}` : 'פתח את הליד'}
      </Link>
    )
  }

  if (accessDenied) {
    return <SubscriptionExpiredState mode='inline' source='messenger_lead' feature='חידוש המנוי מחזיר את יצירת הלידים' />
  }

  const handle = (result: MessengerLeadResult, success: string) => {
    if ('reason' in result) {
      toast('error', FAILURE_COPY[result.reason] ?? FAILURE_COPY.create_failed)
      return
    }
    toast('success', success)
    router.refresh()
  }

  const create = () =>
    run(async () => handle(await createLeadFromMessengerConversation(conversationId), 'הליד נוצר בהצלחה'))

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Btn
        lbl={loading ? 'יוצר ליד...' : 'צור ליד'}
        icon={loading ? 'spinner' : undefined}
        iconClassName={loading ? 'animate-spin' : undefined}
        variant='outline'
        size='small'
        className='w-fit'
        disabled={loading}
        onClick={create}
      />
      <div className='w-52'>
        <LeadPicker
          currentLeadId={0}
          currentLeadName='קשר לליד קיים'
          recentLeads={[]}
          onPick={(id) =>
            run(async () => handle(await linkMessengerConversationToLead(conversationId, id), 'השיחה קושרה לליד'))
          }
          onCreateNew={create}
        />
      </div>
    </div>
  )
}
