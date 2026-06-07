import Link from 'next/link'

export default function QuickLinks({
  dueCount,
  newCount,
  upcomingCount,
  meetingsCount,
}: {
  dueCount: number
  newCount: number
  upcomingCount: number
  meetingsCount: number
}) {
  const items = [
    { label: 'כל המעקבים', count: dueCount, href: '/leads?view=due' },
    { label: 'לידים חדשים', count: newCount, href: '/leads' },
    { label: 'מעקבים קרובים', count: upcomingCount, href: '/leads' },
    { label: 'פגישות היום', count: meetingsCount, href: '/calendar' },
  ]

  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          className='inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50'
        >
          <span className='text-gray-700'>{it.label}</span>
          <span className='font-medium tabular-nums text-gray-900'>{it.count}</span>
        </Link>
      ))}
    </div>
  )
}
