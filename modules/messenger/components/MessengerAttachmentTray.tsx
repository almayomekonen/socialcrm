'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { UploadState } from '../useAttachmentUpload'

/**
 * The file the rep has chosen, before and during sending.
 *
 * THE PREVIEW IS LOCAL. An image preview comes from an object URL for the file
 * already on the rep's machine — nothing is uploaded to show it, and the URL is
 * revoked when the tray closes so the blob is not held for the life of the tab.
 *
 * THE PROGRESS IS REAL. `progress` is null until the browser reports bytes
 * actually sent, so the bar is indeterminate rather than confidently at 0%. Once
 * the bytes are gone and the server is talking to Meta, the phase becomes
 * `sending` and the label says so. Nothing here animates to imply work that is
 * not happening.
 */

function readableSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

export default function MessengerAttachmentTray({
  file,
  upload,
  onRemove,
}: {
  file: File
  upload: UploadState
  onRemove: () => void
}) {
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const busy = upload.phase === 'uploading' || upload.phase === 'sending'
  const pct = upload.phase === 'uploading' ? upload.progress : upload.phase === 'sending' ? 100 : null
  const status =
    upload.phase === 'sending'
      ? 'שולח…'
      : upload.phase === 'uploading'
        ? pct === null
          ? 'מעלה…'
          : `מעלה… ${pct}%`
        : readableSize(file.size)

  return (
    <div className='mb-2 flex items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 p-2'>
      {preview ? (
        /* eslint-disable-next-line @next/next/no-img-element -- local object URL for a file the rep just picked */
        <img src={preview} alt='' aria-hidden className='size-10 shrink-0 rounded object-cover' />
      ) : (
        <span aria-hidden className='flex size-10 shrink-0 items-center justify-center rounded bg-gray-200 text-[10px] font-medium text-gray-600'>
          {(file.name.split('.').pop() ?? 'file').slice(0, 4).toUpperCase()}
        </span>
      )}

      <div className='min-w-0 flex-1'>
        <p className='truncate text-xs font-medium text-gray-800'>{file.name}</p>
        {/* The only place the upload state is announced. `busy` makes it a live
            region so a screen reader hears progress without polling the DOM. */}
        <p role={busy ? 'status' : undefined} className='mt-0.5 text-[11px] text-gray-500'>
          {status}
        </p>
        {busy && (
          <div
            role='progressbar'
            aria-label='התקדמות העלאה'
            // Omitted entirely while indeterminate: a progressbar with
            // aria-valuenow=0 announces "0 percent", which we do not know.
            aria-valuenow={pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            className='mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-200'
          >
            <div
              className={`h-full bg-primary transition-[width] duration-200 ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
              style={pct === null ? undefined : { width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      <button
        type='button'
        onClick={onRemove}
        aria-label={busy ? 'בטל את העלאת הקובץ' : 'הסר את הקובץ'}
        title={busy ? 'בטל את העלאת הקובץ' : 'הסר את הקובץ'}
        className='flex size-7 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
      >
        <X aria-hidden className='size-3.5' />
      </button>
    </div>
  )
}
