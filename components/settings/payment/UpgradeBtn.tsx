'use client'

import { Btn } from '@/lib/btns/Btn'

type Props = { lbl?: string; variant?: 'solid' | 'outline'; className?: string }

export default function UpgradeBtn({ lbl = 'שדרג למסלול Pro', variant = 'solid', className }: Props) {
  return (
    <Btn
      variant={variant}
      icon='arrow-up-right-from-square'
      lbl={lbl}
      className={className}
      onClick={() => {
        window.location.href = '/api/payments/upgrade'
      }}
    />
  )
}
