import { formatDate } from '@/lib/dates'

/**
 * "פעילות התחברות אחרונה" on a phone — the same rows, without the table.
 *
 * `IpsTable` is the desktop table system (`lib/table`), complete with a column
 * manager and a search box, for three fields. Measured inside the mobile shell
 * it rendered a real `<table>`.
 *
 * The data is unchanged — device, IP and timestamp, straight from
 * `getRecentLoginActivity`. Only the presentation differs: a stacked row per
 * login, with the device first because "was that me?" is the only question this
 * list answers. The IP is `dir='ltr'` and tabular so digits line up under an RTL
 * heading.
 *
 * Server Component: it renders text and nothing else.
 */
export default function LoginActivityMobile({
  rows,
}: {
  rows: { device: string; ip: string; at: string | Date }[]
}) {
  return (
    <ul className='divide-y divide-gray-100'>
      {rows.map((r, i) => (
        <li key={`${r.ip}-${i}`} className='flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0'>
          <div className='flex items-baseline justify-between gap-3'>
            <span className='truncate text-[14px] font-medium text-ink'>{r.device}</span>
            <span className='shrink-0 text-[11px] tabular-nums text-gray-400'>{formatDate(r.at)}</span>
          </div>
          <span className='text-[12px] tabular-nums text-gray-500' dir='ltr'>
            {r.ip}
          </span>
        </li>
      ))}
    </ul>
  )
}
