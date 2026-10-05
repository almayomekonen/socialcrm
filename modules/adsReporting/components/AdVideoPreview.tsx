'use client'

import { useId, useRef, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { getAdPreview } from '@/modules/adsReporting/actions'
import AdCreativeImage from './AdCreativeImage'

/**
 * A video ad's thumbnail that opens Meta's own preview of the ad, so the user can
 * watch it without leaving SocialCRM. The preview URL is requested only on click
 * and dropped on close: Meta's preview links expire after 24 hours. The URL was
 * validated on the server (lib/facebook/ads/adPreview.ts); this component never
 * receives Meta's HTML.
 */

type State = { kind: 'closed' } | { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error' }

export default function AdVideoPreview({ adId, url, name }: { adId: string; url: string | null; name: string }) {
  const [state, setState] = useState<State>({ kind: 'closed' })
  // Only the newest request may update the dialog (a quick close + reopen).
  const request = useRef(0)
  const titleId = useId()

  const open = async () => {
    const mine = ++request.current
    setState({ kind: 'loading' })
    let res: Awaited<ReturnType<typeof getAdPreview>>
    try {
      res = await getAdPreview(adId)
    } catch {
      res = { ok: false }
    }
    if (request.current !== mine) return
    setState(res.ok ? { kind: 'ready', url: res.url } : { kind: 'error' })
  }
  const close = () => {
    request.current++
    setState({ kind: 'closed' })
  }

  return (
    <>
      <button
        type='button'
        onClick={open}
        aria-haspopup='dialog'
        aria-label={`הצגת המודעה ${name}`}
        className='block w-full cursor-pointer rounded-md text-start transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <AdCreativeImage url={url} isVideo name={name} />
      </button>
      {state.kind !== 'closed' && (
        <ModalPop open onClose={close} pos='middle' labelledBy={titleId}>
          <div className='grid w-[min(80vw,380px)] gap-3'>
            <h2 id={titleId} className='text-lg font-semibold text-gray-800'>
              תצוגה מקדימה של המודעה
            </h2>
            {state.kind === 'loading' && (
              <p role='status' className='py-10 text-center text-sm text-gray-500'>
                טוען תצוגה מקדימה…
              </p>
            )}
            {state.kind === 'error' && (
              <p role='alert' className='py-10 text-center text-sm text-gray-600'>
                התצוגה המקדימה לא זמינה כרגע
              </p>
            )}
            {state.kind === 'ready' && (
              <iframe
                src={state.url}
                title={`תצוגה מקדימה של המודעה ${name}`}
                className='block h-[min(70dvh,600px)] w-full rounded-md border border-gray-200'
                sandbox='allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
                allow='autoplay; encrypted-media; fullscreen'
                referrerPolicy='no-referrer'
              />
            )}
          </div>
        </ModalPop>
      )}
    </>
  )
}
