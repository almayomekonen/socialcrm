'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { generateWhatsappReplyDraft } from '@/actions/ai/whatsappReplyDraft'
import { sendWhatsappReply } from '@/actions/whatsapp/sendWhatsappReply'

const MAX_CHARS = 4096

export default function WhatsappReplyDraft({ leadId }: { leadId: number }) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition() 
  const [sending, setSending] = useState(false)

  const hasDraft = draft.trim().length > 0
  const busy = pending || sending

  const generate = () => {
    setError(null)
    startTransition(async () => {
      const res = await generateWhatsappReplyDraft(leadId)
      if (res.ok) setDraft(res.message.slice(0, MAX_CHARS))
      else setError('לא ניתן היה לנסח טיוטה כרגע. נסה שוב.')
    })
  }

  const handleCopy = async () => {
    const ok = await copyToClipboard(draft)
    if (ok) toast('success', 'הטיוטה הועתקה')
    else toast('error', 'ההעתקה נכשלה')
  }

  const handleSend = async () => {
    if (!hasDraft || sending) return 
    setSending(true)
    setError(null)
    try {
      const res = await sendWhatsappReply(leadId, draft)
      if (res.ok) {
        setDraft('')
        toast('success', 'ההודעה נשלחה')
        router.refresh() 
      } else {
        toast('error', 'שליחת ההודעה נכשלה')
      }
    } catch {
      toast('error', 'שליחת ההודעה נכשלה')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className='mt-3'>
      <label htmlFor='wa-reply-draft' className='block text-sm font-medium text-gray-700 mb-1'>
        טיוטת תשובה
      </label>
      <textarea
        id='wa-reply-draft'
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
        onKeyDown={(e) => {

          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleSend()
          }
        }}
        rows={3}
        disabled={sending}
        placeholder='כתוב טיוטה לתשובה...'
        aria-label='טיוטת תשובה בוואטסאפ'
        className='w-full resize-none rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:opacity-50'
      />
  
      <div className='mt-2 flex items-center gap-2'>
        <Button type='button' variant='outline' size='sm' onClick={generate} disabled={busy}>
          {pending ? 'מנסח...' : hasDraft ? 'נסח מחדש עם AI' : 'נסח טיוטה עם AI'}
        </Button>
        <Button type='button' variant='outline' size='sm' onClick={handleCopy} disabled={!hasDraft || busy}>
          העתק
        </Button>
        <Button type='button' size='sm' onClick={handleSend} disabled={!hasDraft || busy}>
          {sending ? 'שולח...' : 'שלח'}
        </Button>
      </div>

      <div className='mt-1'>
        <span className='text-xs text-gray-500 tabular-nums'>
          {draft.length} / {MAX_CHARS} תווים
        </span>
      </div>
      {error && <p className='mt-1 text-xs text-red-500'>{error}</p>}
    </div>
  )
}
