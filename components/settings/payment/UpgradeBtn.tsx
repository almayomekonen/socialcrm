'use client'

import { Btn } from '@/lib/btns/Btn'

type Props = { lbl?: string; variant?: 'solid' | 'outline'; className?: string; source?: string }

export default function UpgradeBtn({ lbl = 'שדרג למסלול Pro', variant = 'solid', className, source }: Props) {
  return (
    <Btn
      variant={variant}
      icon='arrow-up-right-from-square'
      lbl={lbl}
      className={className}
      onClick={() => {
        // Optional analytics attribution; default URL unchanged for existing callers.
        window.location.href = source ? `/api/payments/upgrade?source=${encodeURIComponent(source)}` : '/api/payments/upgrade'
      }}
    />
  )
}
