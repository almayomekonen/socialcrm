'use client'

import { useState, useTransition } from 'react'
import {
  applyWhatsappTokenSealAction,
  inspectWhatsappTokensAction,
  type TokenSealApplyActionResult,
} from '@/actions/admin/waTokenSeal'
import type { TokenSealInspection } from '@/lib/whatsapp/tokenSealJob'
import { TOKEN_SEAL_CONFIRMATION } from '@/lib/whatsapp/tokenSealConfirmation'
import { Btn } from '@/lib/btns/Btn'

/**
 * Sealing the WhatsApp tokens that were stored in plaintext. Runs inside this
 * deployment with its own key. "בדיקה" is read-only and doubles as verify; sealing
 * needs a fresh check plus the typed phrase, and refuses if anything changed since the
 * check. Only counts and row ids are shown. Pending is local to each button.
 */

const ids = (list: number[]) => (list.length ? list.join(', ') : 'אין')

function Counts({ i }: { i: TokenSealInspection }) {
  return (
    <dl className='mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm desktop:w-96'>
      <dt className='text-gray-500'>חיבורים</dt>
      <dd className='text-gray-900'>{i.total}</dd>
      <dt className='text-gray-500'>מוצפנים</dt>
      <dd className='text-gray-900'>{i.sealed}</dd>
      <dt className='text-gray-500'>לא מוצפנים</dt>
      <dd className='text-gray-900'>{i.plaintext}</dd>
      <dt className='text-gray-500'>מזהי שורות לא מוצפנות</dt>
      <dd className='text-gray-900'>{ids(i.plaintextIds)}</dd>
      <dt className='text-gray-500'>מוצפנים שלא נפתחים</dt>
      <dd className={i.unreadableIds.length ? 'font-medium text-error' : 'text-gray-900'}>{ids(i.unreadableIds)}</dd>
    </dl>
  )
}

function describeApply(r: TokenSealApplyActionResult): { tone: 'ok' | 'bad'; text: string } {
  switch (r.outcome) {
    case 'applied':
      return r.failedIds.length || r.after.plaintext || r.after.unreadableIds.length
        ? { tone: 'bad', text: `הוצפנו ${r.sealedIds.length}. נכשלו: ${ids(r.failedIds)}. השתנו בזמן הריצה: ${ids(r.changedConcurrentlyIds)}. יש לבדוק לפני ניסיון נוסף.` }
        : { tone: 'ok', text: `הוצפנו ${r.sealedIds.length} חיבורים. כל הטוקנים מוצפנים ונפתחים.` }
    case 'unreadable_present':
      return { tone: 'bad', text: 'יש טוקנים מוצפנים שהמפתח הנוכחי לא פותח. לא נכתב דבר.' }
    case 'plan_changed':
      return { tone: 'bad', text: 'הנתונים השתנו מאז הבדיקה. לא נכתב דבר. יש להריץ בדיקה שוב.' }
    case 'nothing_to_seal':
      return { tone: 'ok', text: 'אין טוקנים לא מוצפנים. לא נכתב דבר.' }
    case 'invalid':
      return { tone: 'bad', text: 'האישור אינו תקין. לא נכתב דבר.' }
    case 'forbidden':
      return { tone: 'bad', text: 'אין הרשאה לפעולה הזו.' }
    default:
      return { tone: 'bad', text: 'הפעולה נכשלה. לא לנסות שוב לפני בדיקה.' }
  }
}

export default function WaTokenSealPanel() {
  const [inspection, setInspection] = useState<TokenSealInspection | null>(null)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [phrase, setPhrase] = useState('')
  const [result, setResult] = useState<TokenSealApplyActionResult | null>(null)
  const [checking, startCheck] = useTransition()
  const [sealing, startSeal] = useTransition()

  function check() {
    startCheck(async () => {
      const r = await inspectWhatsappTokensAction()
      setResult(null)
      setPhrase('')
      if (r.outcome === 'ok') {
        setInspection(r.inspection)
        setInspectError(null)
      } else {
        setInspection(null)
        setInspectError(r.outcome === 'forbidden' ? 'אין הרשאה לפעולה הזו.' : 'הבדיקה נכשלה.')
      }
    })
  }

  function seal() {
    if (!inspection) return
    startSeal(async () => {
      setResult(await applyWhatsappTokenSealAction({ planFingerprint: inspection.planFingerprint, confirmation: phrase }))
      setInspection(null)
      setPhrase('')
    })
  }

  const canSeal = !!inspection && inspection.plaintext > 0 && inspection.unreadableIds.length === 0 && phrase === TOKEN_SEAL_CONFIRMATION
  const shown = result ? describeApply(result) : null

  return (
    <section aria-labelledby='wa-token-seal' className='mt-8 rounded-2xl border border-gray-200 bg-white p-4'>
      <h2 id='wa-token-seal' className='text-sm font-semibold text-gray-900'>
        הצפנת טוקנים של חיבורי וואטסאפ
      </h2>
      <p className='mt-1 text-sm text-gray-500'>
        הבדיקה קוראת בלבד. ההצפנה כותבת רק את השורות שהבדיקה הציגה, ומסרבת אם משהו השתנה מאז. החיבורים ממשיכים לעבוד לאורך כל הפעולה.
      </p>
      <Btn type='button' lbl={checking ? 'בודק…' : 'בדיקת מצב הטוקנים'} onClick={check} disabled={checking || sealing} className='mt-3 w-full desktop:w-auto' />
      {inspectError && (
        <p role='alert' className='mt-3 text-sm font-medium text-error'>
          {inspectError}
        </p>
      )}
      {inspection && <Counts i={inspection} />}
      {inspection && inspection.unreadableIds.length > 0 && (
        <p role='alert' className='mt-3 text-sm font-medium text-error'>
          יש טוקנים מוצפנים שהמפתח הנוכחי לא פותח. לא ניתן להצפין עד שזה ייבדק.
        </p>
      )}
      {inspection && inspection.plaintext > 0 && inspection.unreadableIds.length === 0 && (
        <div className='mt-4'>
          <label htmlFor='wa-token-seal-phrase' className='block text-sm font-medium text-gray-900'>
            כדי להצפין {inspection.plaintext} חיבורים, יש להקליד: {TOKEN_SEAL_CONFIRMATION}
          </label>
          <input
            id='wa-token-seal-phrase'
            autoComplete='off'
            dir='ltr'
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            disabled={sealing}
            className='mt-2 w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-primary desktop:w-80'
          />
          <Btn
            type='button'
            lbl={sealing ? 'מצפין…' : `הצפנת ${inspection.plaintext} טוקנים`}
            onClick={seal}
            disabled={!canSeal || sealing}
            className='mt-3 w-full desktop:w-auto'
          />
        </div>
      )}
      {shown && (
        <p role={shown.tone === 'ok' ? 'status' : 'alert'} className={`mt-3 text-sm font-medium ${shown.tone === 'ok' ? 'text-green-800' : 'text-error'}`}>
          {shown.text}
        </p>
      )}
      {result?.outcome === 'applied' && <Counts i={result.after} />}
    </section>
  )
}
