import { Suspense } from 'react'
import type { Metadata } from 'next'
import AdminWhatsappReadiness from '@/components/admin/whatsapp/AdminWhatsappReadiness'

export const metadata: Metadata = { title: 'וואטסאפ · ניהול מערכת' }

/** Read-only readiness of the owner-reminder sender. Platform owners only (gate in the component). */
export default function AdminWhatsappPage() {
  return (
    <Suspense fallback={<div className='mx-auto max-w-6xl px-4 py-10 text-gray-400'>טוען…</div>}>
      <AdminWhatsappReadiness />
    </Suspense>
  )
}
