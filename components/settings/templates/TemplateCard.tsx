'use client'

import { useState, useTransition } from 'react'
import Icon, { type IconNames } from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { StatusBadge } from '@/lib/StatusBadge'
import { toast } from '@/lib/toast'
import { uninstallTemplate } from '@/actions/automations/templates'
import type { TemplateView } from '@/lib/automations/templates/overview'
import TemplateInstallDialog from './TemplateInstallDialog'
import { errorMessage } from './copy'

/**
 * ONE card for every template. It renders title, description, icon, what the
 * template would create, and its install state — all from the view.
 *
 * A locked template is SHOWN with the requirement's own CTA rather than
 * hidden: someone browsing the marketplace is deciding what to connect, and
 * hiding the reason to connect makes that decision impossible.
 */
export default function TemplateCard({ view, onChanged }: { view: TemplateView; onChanged: () => void }) {
  const [installing, setInstalling] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pending, start] = useTransition()

  const { template, availability, installed, updateAvailable } = view
  const locked = availability.state === 'locked' ? availability.requirement : null

  function remove() {
    start(async () => {
      const res = await uninstallTemplate(template.key)
      setConfirmRemove(false)
      if (res.ok === false) return toast('error', errorMessage(res.reason))
      toast('success', 'התבנית הוסרה')
      onChanged()
    })
  }

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-6 grid gap-4 content-start'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2.5 min-w-0'>
          <Icon name={template.icon as IconNames} className='size-7 bg-gray-900 shrink-0' />
          <h2 className='text-lg font-bold text-dark truncate'>{template.title}</h2>
        </div>
        {installed > 0 && <StatusBadge role='success' label='מותקן' size='sm' />}
      </div>

      <p className='text-sm text-gray-600 leading-relaxed'>{template.description}</p>

      <ul className='grid gap-1'>
        {view.preview.map((p, i) => (
          <li key={i} className='text-sm text-gray-500'>
            {p.name}
          </li>
        ))}
      </ul>

      {locked && (
        <div className='grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-3' role='alert'>
          <p className='text-sm text-amber-800'>התבנית הזו דורשת חיבור שעדיין לא קיים בחשבון.</p>
          {locked.cta && <Btn variant='outline' size='small' lbl={locked.cta.label} href={locked.cta.href} />}
        </div>
      )}

      {updateAvailable && (
        <div className='grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-3'>
          <p className='text-sm text-gray-700'>
            קיימת גרסה חדשה של התבנית. האוטומציות שכבר התקנתם לא ישתנו — התקנה תיצור עותק חדש לצידן.
          </p>
          {view.changes.length > 0 && (
            <ul className='grid gap-1'>
              {view.changes.map((c) => (
                <li key={c.version} className='text-sm text-gray-500'>
                  {c.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Btn
          size='small'
          lbl={installed > 0 ? 'התקנה נוספת' : 'התקנה'}
          icon='plus'
          variant={installed > 0 ? 'outline' : 'solid'}
          disabled={Boolean(locked) || pending}
          onClick={() => setInstalling(true)}
        />
        {installed > 0 && (
          <>
            <span className='text-sm text-gray-500'>
              {installed === 1 ? 'אוטומציה אחת מותקנת' : `${installed} אוטומציות מותקנות`}
            </span>
            <Btn variant='ghost' size='small' lbl='הסרה' icon='trash' disabled={pending} onClick={() => setConfirmRemove(true)} />
          </>
        )}
      </div>

      {installing && (
        <TemplateInstallDialog
          view={view}
          onClose={() => setInstalling(false)}
          onDone={() => {
            setInstalling(false)
            onChanged()
          }}
        />
      )}

      <ConfirmPop
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={remove}
        msg={`הסרת "${template.title}" תמחק ${installed === 1 ? 'את האוטומציה שנוצרה ממנה' : `את ${installed} האוטומציות שנוצרו ממנה`}. אוטומציות שיצרתם בעצמכם לא ייגעו.`}
        confirmLbl='הסרה'
        destructive
      />
    </div>
  )
}
