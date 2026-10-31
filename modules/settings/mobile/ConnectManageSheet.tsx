import type { ReactNode } from 'react'
import BottomSheet from '@/components/mobile/BottomSheet'

/**
 * Hosts the EXISTING connect components (WhatsappConnect, FacebookConnect,
 * CalendarConnect, IntegrationCard) inside a phone sheet.
 *
 * Those components own OAuth, disconnect, and health copy. This wrapper only
 * changes geometry: 44px touch targets and 16px inputs so iOS does not zoom,
 * without editing the desktop connect UIs.
 */

const TOUCH =
  '[&_button]:min-h-11 [&_button]:w-full [&_select]:h-11 [&_select]:text-base [&_input]:h-11 [&_input]:text-base [&_textarea]:text-base'

export default function ConnectManageSheet({
  open,
  onClose,
  title,
  titleId,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  titleId: string
  children: ReactNode
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title} titleId={titleId} translated>
      <div className={TOUCH}>{children}</div>
    </BottomSheet>
  )
}
