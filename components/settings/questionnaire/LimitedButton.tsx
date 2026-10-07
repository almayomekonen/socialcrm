'use client'

import { useId, useState, type ComponentProps } from 'react'
import { Btn } from '@/lib/btns/Btn'

/**
 * A Builder button that is sometimes unavailable for a reason the owner needs
 * to know ("אפשר עד 10 אפשרויות בשאלה").
 *
 * A `disabled` button with a `title` tooltip tells only mouse users why: a
 * disabled button cannot take keyboard focus, and the tooltip is hover-only.
 * Here the button stays focusable and is announced as unavailable
 * (`aria-disabled`), the reason is its accessible description at all times,
 * and activating it shows the reason on screen instead of doing nothing.
 */
export default function LimitedButton({
  blockedReason,
  onClick,
  className,
  ...btn
}: Omit<ComponentProps<typeof Btn>, 'disabled' | 'title'> & { blockedReason: string | null; onClick: () => void }) {
  const id = useId()
  const [shown, setShown] = useState(false)
  const blocked = blockedReason !== null

  return (
    <span className='inline-grid gap-1'>
      <Btn
        {...btn}
        type='button'
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? `${id}-why` : undefined}
        className={`${className ?? ''} ${blocked ? 'cursor-not-allowed opacity-50' : ''}`}
        onClick={() => (blocked ? setShown(true) : onClick())}
      />
      {blocked && (
        <span id={`${id}-why`} role='status' className={shown ? 'text-xs text-gray-600' : 'sr-only'}>
          {blockedReason}
        </span>
      )}
    </span>
  )
}
