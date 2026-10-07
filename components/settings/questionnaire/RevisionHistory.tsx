'use client'

import { useEffect, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { listQuestionnaireRevisions } from '@/actions/questionnaire/builderPublish'
import { formatDateTime } from './builderCopy'

type Revision = {
  revision: number
  publishedAt: string
  publishedByName: string | null
  source: 'builder' | 'staff' | 'backfill'
  activeSessions: number
}

/**
 * The published versions, newest first: what is live, when each was published
 * and by whom when that is known. Only what `questionnaire_revisions` holds is
 * shown; a version with no row (before history existed) is not invented.
 *
 * "יצירת טיוטה מגרסה זו" copies a version into the draft. Publishing it makes a
 * NEW version; numbers only go forward and no published version ever changes.
 */
export default function RevisionHistory({
  open,
  onClose,
  onRestore,
  answering,
}: {
  open: boolean
  onClose: () => void
  onRestore: (revision: number) => void
  /** Whether the newest version is what WhatsApp customers actually receive. */
  answering: boolean
}) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(false)
    void listQuestionnaireRevisions()
      .then((res) => {
        if (cancelled) return
        if (res.ok === true) setRevisions(res.revisions)
        else setError(true)
      })
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [open])

  const live = revisions?.[0]?.revision ?? null

  return (
    <ModalPop open={open} onClose={onClose} pos='middle' label='היסטוריית הגרסאות'>
      <div className='grid min-w-[min(32rem,85vw)] gap-4 pt-2'>
        <div>
          <h2 className='text-lg font-semibold text-ink'>היסטוריית הגרסאות</h2>
          <p className='mt-1 text-sm text-gray-600'>
            כל פרסום שומר גרסה חדשה, וגרסאות קודמות נשארות כאן. &quot;יצירת טיוטה מגרסה זו&quot; מעתיקה גרסה לעריכה. היא תגיע
            ללקוחות רק אחרי שתפרסמו אותה, כגרסה חדשה.
          </p>
        </div>

        {error && (
          <p role='alert' className='text-sm text-red-600'>
            לא הצלחנו לטעון את הגרסאות. נסו שוב.
          </p>
        )}
        {!error && revisions === null && <p className='text-sm text-gray-500'>טוען…</p>}
        {revisions?.length === 0 && <p className='text-sm text-gray-600'>עוד לא פורסמה גרסה.</p>}

        {revisions && revisions.length > 0 && (
          <ul className='grid max-h-[60vh] gap-2 overflow-y-auto'>
            {revisions.map((r) => (
              <li
                key={r.revision}
                className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 p-3'
              >
                <div className='grid gap-0.5'>
                  <p className='text-sm font-semibold text-ink'>
                    גרסה {r.revision}
                    {r.revision === live && (
                      <span className='ms-2 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800'>
                        {answering ? 'פעילה בוואטסאפ' : 'הגרסה האחרונה שפורסמה'}
                      </span>
                    )}
                  </p>
                  <p className='text-xs text-gray-600'>
                    {/* A backfilled row's date is when history began, not when that version went live. */}
                    {r.source === 'backfill'
                      ? 'הגרסה שהייתה פעילה כשהתחלנו לשמור היסטוריה · הוגדרה על ידי צוות SocialCRM'
                      : `פורסמה ב־${formatDateTime(r.publishedAt)}${r.publishedByName ? ` · ${r.publishedByName}` : r.source === 'staff' ? ' · על ידי צוות SocialCRM' : ''}`}
                  </p>
                  {r.activeSessions > 0 && (
                    <p className='text-xs text-gray-600'>
                      {r.activeSessions === 1
                        ? 'שיחה פעילה אחת ממשיכה בגרסה הזו'
                        : `${r.activeSessions} שיחות פעילות ממשיכות בגרסה הזו`}
                    </p>
                  )}
                </div>
                <Btn
                  type='button'
                  size='small'
                  variant='outline'
                  lbl='יצירת טיוטה מגרסה זו'
                  onClick={() => onRestore(r.revision)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalPop>
  )
}
