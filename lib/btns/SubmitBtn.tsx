'use client'

import { useFormStatus } from 'react-dom'
import { Btn } from '@/lib/btns/Btn'
import { IconNames } from '@/lib/Icon'

export function SubmitButton({
  className,
  lbl,
  icon = 'floppy-disk',
  disabled,
}: {
  className?: string
  lbl?: string
  icon?: IconNames | false
  disabled?: boolean
}) {
  const res = useFormStatus()
  const pending = res.pending

  return <Btn lbl={pending ? 'טוען...' : lbl || 'שמירה'} icon={icon || undefined} disabled={pending || disabled} className={className} />
}
