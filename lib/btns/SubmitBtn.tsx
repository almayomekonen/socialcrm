'use client'

import { useFormStatus } from 'react-dom'
import { Btn } from '@/lib/btns/Btn'
import { IconNames } from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()
  const res = useFormStatus()
  const pending = res.pending

  return <Btn lbl={pending ? t('common.toast.loading') : lbl || t('common.save')} icon={icon || undefined} disabled={pending || disabled} className={className} />
}
