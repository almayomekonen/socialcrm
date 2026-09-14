import ConnectionNotice from '@/components/settings/ConnectionNotice'
import MetaPermissionButton from '@/components/settings/MetaPermissionButton'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'

/**
 * A missing Meta permission: the explanation, and the one action that fixes it.
 * Only an agency admin may start a Facebook authorization (the OAuth routes are
 * admin-only), so anyone else is told who can approve it rather than being given
 * a button that ends on a "forbidden" notice.
 */
export default function MetaPermissionPrompt({ notice, href, canAuthorize }: { notice: Notice; href: string; canAuthorize: boolean }) {
  return (
    <div className='grid gap-2'>
      <ConnectionNotice notice={notice} />
      {canAuthorize ? (
        <MetaPermissionButton href={href} lbl={notice.action ?? 'אשר הרשאה'} />
      ) : (
        <p className='text-sm text-gray-600'>מנהל החשבון צריך לאשר את ההרשאה בפייסבוק.</p>
      )}
    </div>
  )
}
