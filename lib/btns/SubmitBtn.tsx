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
  icon?: IconNames
  disabled?: boolean
}) {
  const res = useFormStatus()
  const pending = res.pending

  return <Btn lbl={pending ? 'טוען...' : lbl || 'שמירה'} icon={icon} disabled={pending || disabled} className={className} />
}
