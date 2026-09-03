'use client'

import { useMemo, useState, useTransition } from 'react'
import { addLeads } from '@/actions/clients'
import { parsePastedLeads } from '@/lib/leads/pastedLeads'
import { FIRST_RUN_COPY as C } from '@/lib/activation/firstRunCopy'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'

/**
 * Paste a column of phone numbers and import them as לידים.
 *
 * ONE panel, both surfaces. Desktop mounts it in the existing import modal and
 * mobile in the existing import sheet, so there is no second import product to
 * keep in sync — only a second way to hand it rows.
 *
 * It is NOT a lesser path. On a phone inside Facebook's in-app browser, where a
 * measurable share of this product's signups arrive, there is no spreadsheet on
 * the device to pick, so the file input is a dead end and this is the only
 * import that can complete. Rows go through the same `addLeads` as a file: same
 * quota, same dedupe, same `leads_imported` event (carrying `format: 'paste'`).
 *
 * Honesty rules it follows (`care-charter.md` Law 1): the button never claims a
 * count before the text is parsed, unreadable lines are reported rather than
 * dropped, and a truncated paste says so.
 */
export default function PasteLeadsPanel({
  onImported,
}: {
  onImported?: (inserted: number, firstId?: number) => void
}) {
  const [text, setText] = useState('')
  const [pending, startTransition] = useTransition()

  // Parsed on every keystroke so the count under the button is always the truth
  // about what will actually be inserted. Cheap: bounded by MAX_ROWS.
  const parsed = useMemo(() => parsePastedLeads(text), [text])
  const count = parsed.rows.length

  function submit() {
    if (pending || count === 0) return
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof addLeads>>
      try {
        res = await addLeads(parsed.rows, 'paste')
      } catch {
        toast('error', 'לא הצלחנו להוסיף את הלידים. נסו שוב.')
        return
      }
      if ('error' in res) {
        // Quota is the one refusal with its own product surface; say what it is
        // rather than failing vaguely.
        toast('error', `הגעתם למכסת הלידים (${res.limit}). לא הוספנו את הרשימה.`)
        return
      }
      setText('')
      onImported?.(res.inserted, res.firstId)
    })
  }

  return (
    <div dir='rtl' className='flex flex-col gap-3'>
      <label htmlFor='paste-leads' className='text-sm font-medium text-ink'>
        {C.paste.label}
      </label>

      <textarea
        id='paste-leads'
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        dir='ltr'
        placeholder={C.paste.placeholder}
        className='w-full resize-y rounded-lg border border-gray-300 bg-white p-3 text-sm leading-relaxed text-ink placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30'
      />

      <p className='text-xs text-gray-500'>{C.paste.hint}</p>

      {/* Everything the parse found that the user should know about, before
          they commit. role=status so a screen reader hears the count change. */}
      <div role='status' aria-live='polite' className='flex flex-col gap-1 text-xs'>
        {parsed.skipped > 0 && <span className='text-warning-text'>{C.paste.skipped(parsed.skipped)}</span>}
        {parsed.truncated && <span className='text-warning-text'>{C.paste.truncated}</span>}
        {text.trim().length > 0 && count === 0 && parsed.skipped > 0 && (
          <span className='text-error-text'>{C.paste.empty}</span>
        )}
      </div>

      <Btn
        variant='solid'
        size='large'
        className='w-full justify-center'
        lbl={pending ? C.paste.pending : count > 0 ? C.paste.submit(count) : C.paste.submitEmpty}
        onClick={submit}
        disabled={pending || count === 0}
      />
    </div>
  )
}
