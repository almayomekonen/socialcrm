'use client'

import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import type { SetupGuide } from '@/lib/automations/connectors/types'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Renders whatever a connector says the customer must do — steps, an optional
 * copy-paste block, an optional link. It reads none of it.
 *
 * This is the sanctioned home for integration-specific instructions: the
 * connector knows, the UI renders. The alternative was a WordPress-shaped
 * branch inside a page that is meant to serve five hundred integrations.
 */
/** `guide` arrives worded for the screen (`setupGuideIn`); the snippet's code is shown and copied as the connector wrote it. */
export default function SetupGuidePanel({ guide, webhookUrl }: { guide: SetupGuide | null; webhookUrl: string }) {
  const t = useT()
  return (
    <div className='grid gap-4 min-w-0'>
      <CopyRow label={t('admin.connections.connect.webhookUrl')} value={webhookUrl} copyLabel={t('admin.connections.connect.copy')} copiedLabel={t('admin.connections.connect.copied')} />

      {guide && (
        <>
          <h4 className='text-sm font-semibold text-gray-800'>{guide.title}</h4>
          <ol className='grid gap-1.5 ps-5 list-decimal marker:text-gray-400'>
            {guide.steps.map((step, i) => (
              <li key={i} className='text-sm text-gray-600 leading-relaxed'>
                {step}
              </li>
            ))}
          </ol>

          {guide.snippet && (
            <div className='grid gap-1 min-w-0'>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-sm text-gray-500'>{guide.snippet.label}</span>
                <Btn
                  variant='outline'
                  size='small'
                  lbl={t('admin.connections.connect.copyCode')}
                  icon='copy'
                  onClick={() => {
                    navigator.clipboard?.writeText(guide.snippet!.code)
                    toast('success', t('admin.connections.connect.copied'))
                  }}
                />
              </div>
              <pre
                dir='ltr'
                // Bounded in BOTH axes: a long line scrolls inside the block
                // instead of widening the dialog past the viewport.
                className='max-h-56 max-w-full overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 scrollbar-slim'
              >
                <code>{guide.snippet.code}</code>
              </pre>
            </div>
          )}

          {guide.link && <Btn variant='ghost' size='small' lbl={guide.link.label} href={guide.link.href} />}
        </>
      )}
    </div>
  )
}

/** `copyLabel` / `copiedLabel`: the caller's words when its screen is translated (AI connections). Default Hebrew. */
export function CopyRow({ label, value, copyLabel = 'העתקה', copiedLabel = 'הועתק' }: { label: string; value: string; copyLabel?: string; copiedLabel?: string }) {
  return (
    <div className='grid gap-1.5 min-w-0'>
      <span className='text-sm text-gray-500'>{label}</span>
      {/* `break-all`, not `truncate`: a webhook URL the customer must paste
          elsewhere has to be readable in full. `items-start` keeps the copy
          button on the first line when the value wraps. */}
      <div className='flex items-start gap-2 min-w-0'>
        <code
          dir='ltr'
          className='min-w-0 flex-1 break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-800'
        >
          {value}
        </code>
        <Btn
          variant='outline'
          size='small'
          lbl={copyLabel}
          icon='copy'
          onClick={() => {
            navigator.clipboard?.writeText(value)
            toast('success', copiedLabel)
          }}
        />
      </div>
    </div>
  )
}
