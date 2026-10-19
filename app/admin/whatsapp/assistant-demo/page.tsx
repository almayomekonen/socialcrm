import { Suspense } from 'react'
import type { Metadata } from 'next'
import AssistantDemoPanel from '@/components/admin/whatsapp/assistantDemo/AssistantDemoPanel'

export const metadata: Metadata = { title: 'הדמיית SocialCRM AI · ניהול מערכת' }

/**
 * A SIMULATION of SocialCRM AI on WhatsApp, for showing the product. Platform
 * owners only (gate in the panel). The demo component makes no server call:
 * nothing is read from or written to any CRM, and nothing is sent.
 */
export default function AssistantDemoPage() {
  return (
    <Suspense fallback={<div className='mx-auto max-w-6xl px-4 py-10 text-gray-400'>טוען…</div>}>
      <AssistantDemoPanel />
    </Suspense>
  )
}
