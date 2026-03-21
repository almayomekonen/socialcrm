'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'

type Page = { id: string; name: string; access_token: string }
type Connection = { pageId: string; pageName: string }

type Props = {
  connection: Connection | null
  pendingPages: Page[] | null
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'לא אושרו הרשאות פייסבוק.',
  state: 'שגיאת אבטחה. אנא נסה שוב.',
  token: 'שגיאה בהתחברות לפייסבוק. אנא נסה שוב.',
  pages: 'לא ניתן לטעון את הדפים. אנא נסה שוב.',
  no_pages: 'לא נמצאו דפים בחשבון הפייסבוק. יש לוודא שיש לך גישת מנהל לדף.',
}

export default function FacebookConnect({ connection, pendingPages }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')

  const [selectedPageId, setSelectedPageId] = useState('')
  const [loading, setLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // State C: Already connected
  if (connection) {
    return (
      <div className='grid gap-4'>
        <p className='text-sm text-gray-600'>
          מחובר לדף: <strong>{connection.pageName}</strong>
        </p>
        <Btn
          lbl='נתק דף'
          variant='destructive'
          size='small'
          className='w-fit'
          disabled={loading}
          onClick={async () => {
            if (!confirm(`לנתק את הדף "${connection.pageName}"?`)) return
            setLoading(true)
            await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
            router.refresh()
          }}
        />
      </div>
    )
  }

  // State B: OAuth done, page not yet selected
  if (pendingPages) {
    const selected = pendingPages.find((p) => p.id === selectedPageId)

    return (
      <div className='grid gap-4'>
        <p className='text-sm text-gray-600'>בחר את הדף שברצונך לחבר:</p>
        <FormField lbl='דף פייסבוק' error={connectError ?? undefined}>
          <select
            className='h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-blue-200'
            value={selectedPageId}
            onChange={(e) => setSelectedPageId(e.target.value)}
          >
            <option value=''>בחר דף...</option>
            {pendingPages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FormField>
        <Btn
          lbl='חבר דף'
          icon='facebook'
          size='medium'
          disabled={!selectedPageId || loading}
          className='w-fit'
          onClick={async () => {
            if (!selected) return
            setLoading(true)
            setConnectError(null)
            const res = await fetch('/api/auth/facebook/connect', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pageId: selected.id,
                pageName: selected.name,
                pageAccessToken: selected.access_token,
              }),
            })
            if (res.ok) {
              router.refresh()
            } else {
              setConnectError('שגיאה בחיבור הדף. אנא נסה שוב.')
              setLoading(false)
            }
          }}
        />
      </div>
    )
  }

  // State A: Not connected
  return (
    <div className='grid gap-4'>
      {urlError && (
        <p className='text-sm text-red-600'>{ERROR_MESSAGES[urlError] ?? 'שגיאה בהתחברות לפייסבוק.'}</p>
      )}
      <p className='text-sm text-gray-500'>חבר את דף הפייסבוק שלך כדי לקבל לידים אוטומטית.</p>
      <Btn lbl='חבר חשבון פייסבוק' icon='facebook' href='/api/auth/facebook' className='w-fit' />
    </div>
  )
}
