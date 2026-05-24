'use client'

import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import type { DriveResultItem, DriveResults } from '@/lib/copilot/copilotResponse'
import { iconForDriveMime } from '@/lib/copilot/driveMimeIcon'

function shouldShowThumbnail(mimeType: string, thumbnailUrl?: string): boolean {
  if (!thumbnailUrl) return false
  return mimeType.startsWith('image/') || mimeType === 'application/pdf'
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

export function DriveResultsBody({ data }: { data: DriveResults }) {
  return (
    <div dir='rtl' className='pt-1'>
      {data.intro && (
        <p className='text-[13px] leading-relaxed text-gray-900 mb-2 wrap-break-word text-right'>
          {data.intro}
        </p>
      )}

      <ul className='flex flex-col gap-2 w-full'>
        {data.results.map((r) => (
          <li key={r.id} className='w-full'>
            <DriveResultRow item={r} />
          </li>
        ))}
      </ul>

      <p
        className='text-[10px] text-gray-400 tracking-wide mt-2 text-right'
        aria-label='מבוסס על Google Drive'
      >
        מבוסס על Google Drive
      </p>
    </div>
  )
}

function DriveResultRow({ item }: { item: DriveResultItem }) {
  const icon = iconForDriveMime(item.mimeType)
  const date = formatDate(item.modifiedTime)
  const showThumbnail = shouldShowThumbnail(item.mimeType, item.thumbnailUrl)

  function openFile() {
    if (!item.url) return
    window.open(item.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className='flex flex-row-reverse items-center gap-2 w-full overflow-hidden rounded-xl border border-gray-100 bg-white p-2 transition-colors hover:bg-gray-50'>
      <div className='shrink-0 size-9 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden'>
        {showThumbnail && item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt='' className='size-full object-cover' referrerPolicy='no-referrer' />
        ) : (
          <Icon name={icon} type='reg' className='size-4 bg-gray-500' />
        )}
      </div>

      <div className='flex-1 min-w-0 text-right overflow-hidden'>
        <p className='text-[12.5px] font-medium text-gray-900 truncate whitespace-nowrap text-right' title={item.name}>
          {item.name}
        </p>
        {date && <p className='text-[10.5px] text-gray-400 text-right'>{date}</p>}
      </div>

      <div className='shrink-0'>
        <Btn lbl='פתח' size='small' variant='outline' onClick={openFile} disabled={!item.url} />
      </div>
    </div>
  )
}
