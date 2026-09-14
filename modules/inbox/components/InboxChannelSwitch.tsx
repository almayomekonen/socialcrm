import Link from 'next/link'
import ChannelIcon from './ChannelIcon'

/**
 * Small channel switch inside the existing שיחות experience (Facebook Comments
 * plan decision D1). WhatsApp conversations and Facebook comments share one
 * nav section — no new top-level item.
 */
export type InboxChannelTab = 'whatsapp' | 'facebook' | 'messenger'

const TABS: { id: InboxChannelTab; href: string; label: string }[] = [
  { id: 'whatsapp', href: '/inbox', label: 'שיחות' },
  { id: 'messenger', href: '/inbox/messenger', label: 'Messenger' },
  { id: 'facebook', href: '/inbox/comments', label: 'תגובות' },
]

/**
 * `showMessenger` is resolved server-side from the Messenger rollout gate, so an
 * agency without Messenger never sees a tab that leads nowhere. Default false:
 * every existing caller renders exactly the two tabs it rendered before.
 */
export default function InboxChannelSwitch({
  active,
  showMessenger = false,
}: {
  active: InboxChannelTab
  showMessenger?: boolean
}) {
  const tabs = TABS.filter((tab) => tab.id !== 'messenger' || showMessenger || active === 'messenger')
  return (
    <nav aria-label='ערוץ' className='flex flex-wrap items-center gap-1.5'>
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              isActive
                ? 'border-info-border bg-primary-tint text-primary-text font-medium'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            <ChannelIcon channel={tab.id} className='size-3.5' />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
