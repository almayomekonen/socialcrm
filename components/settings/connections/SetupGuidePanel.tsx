'use client'

import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import type { SetupGuide } from '@/lib/automations/connectors/types'

/**
 * Renders whatever a connector says the customer must do — steps, an optional
 * copy-paste block, an optional link. It reads none of it.
 *
 * This is the sanctioned home for integration-specific instructions: the
 * connector knows, the UI renders. The alternative was a WordPress-shaped
 * branch inside a page that is meant to serve five hundred integrations.
 */
export default function SetupGuidePanel({ guide, webhookUrl }: { guide: SetupGuide | null; webhookUrl: string }) {
  return (
    <div className='grid gap-3 min-w-0'>
      <CopyRow label='כתובת לשליחה' value={webhookUrl} />

      {guide && (
        <>
          <h4 className='text-sm font-semibold text-gray-800'>{guide.title}</h4>
          <ol className='grid gap-1 ps-4 list-decimal'>
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
                  lbl='העתקת הקוד'
                  icon='copy'
                  onClick={() => {
                    navigator.clipboard?.writeText(guide.snippet!.code)
                    toast('success', 'הועתק')
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

export function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='grid gap-1 min-w-0'>
      <span className='text-sm text-gray-500'>{label}</span>
      <div className='flex items-center gap-2'>
        <code
          dir='ltr'
          className='min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800'
        >
          {value}
        </code>
        <Btn
          variant='outline'
          size='small'
          lbl='העתקה'
          icon='copy'
          onClick={() => {
            navigator.clipboard?.writeText(value)
            toast('success', 'הועתק')
          }}
        />
      </div>
    </div>
  )
}
