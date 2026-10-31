'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { formatDate } from '@/lib/dates'
import type { Template, TemplateStatus } from '@/lib/whatsapp/templates/types'
import { hasPositionalPlaceholder } from '@/lib/whatsapp/templates/parameters'
import MobileListRow, { MobileList } from '@/components/mobile/MobileListRow'
import ConfirmSheet from '@/components/mobile/ConfirmSheet'
import TemplateStatusBadge from '@/components/settings/templates/TemplateStatusBadge'
import ReadyMessageEditorMobile from './ReadyMessageEditorMobile'
import ReadyMessageDetailSheet from './ReadyMessageDetailSheet'
import ReadyMessagesEmptyMobile from './ReadyMessagesEmptyMobile'
import { readyMessageTitle } from './readyMessageTitle'
import { useReadyMessages } from './useReadyMessages'

const SORT_ORDER: Record<TemplateStatus, number> = {
  rejected: 0,
  pending: 1,
  approved: 2,
  paused: 3,
  disabled: 4,
}

const PURPOSE_LABEL: Record<string, string> = {
  UTILITY: 'עדכון',
  MARKETING: 'מבצע',
}

const EDIT_NOTE =
  'יצירת גרסה חדשה לבדיקה. ההודעה הנוכחית תישאר פעילה עד שהגרסה החדשה תאושר — אפשר להעביר אותה לארכיון לאחר מכן.'

/**
 * Phone Ready Messages workspace.
 *
 * Mutations are the existing server actions (create / retry / archive / discard).
 * There is no in-place update — "עריכת הודעה" creates a new template, same as desktop.
 */
export default function ReadyMessagesWorkspace({ initial }: { initial: Template[] }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [retryTarget, setRetryTarget] = useState<Template | null>(null)
  const [editTarget, setEditTarget] = useState<Template | null>(null)
  const [detail, setDetail] = useState<Template | null>(null)
  const [confirm, setConfirm] = useState<null | { kind: 'archive' | 'discard'; template: Template }>(null)

  const closeEditor = () => {
    setCreateOpen(false)
    setRetryTarget(null)
    setEditTarget(null)
  }

  const { templates, handleCreate, runArchive, runDiscard } = useReadyMessages({
    initial,
    retryOf: retryTarget?.id ?? null,
    onCreating: () => {
      closeEditor()
      setDetail(null)
    },
    onRemoved: (id) => setDetail((d) => (d?.id === id ? null : d)),
  })

  const sorted = [...templates].sort((a, b) => (SORT_ORDER[a.status] ?? 9) - (SORT_ORDER[b.status] ?? 9))
  const liveDetail = detail ? templates.find((t) => t.id === detail.id) ?? null : null

  return (
    <div data-testid='ready-messages-mobile' className='px-4 pb-8 pt-4'>
      <Link
        href={'/settings/integrations' as Route}
        className='press mb-3 flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-primary-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <Icon name='angle-right' type='sol' className='size-3.5 bg-primary-text' />
        חזרה לאינטגרציות
      </Link>

      <header className='mb-4'>
        <h1 className='text-xl font-bold leading-tight text-ink'>הודעות מוכנות</h1>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
          הודעות וואטסאפ מאושרות שאפשר לשלוח לליד בכל רגע.
        </p>
      </header>

      {templates.length === 0 ? (
        <ReadyMessagesEmptyMobile onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <button
            type='button'
            onClick={() => setCreateOpen(true)}
            className='press mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='plus' type='sol' className='size-4 bg-white' />
            הודעה מוכנה חדשה
          </button>

          <div className='overflow-hidden rounded-xl border border-gray-200 bg-white'>
            <MobileList>
              {sorted.map((t) => (
                <MobileListRow
                  key={t.id}
                  onClick={() => setDetail(t)}
                  className='press'
                  title={readyMessageTitle(t.displayTitle)}
                  subtitle={t.bodyText || '—'}
                  meta={t.createdAt ? formatDate(t.createdAt) : undefined}
                  badges={
                    <>
                      <TemplateStatusBadge status={t.status} />
                      {t.category && (
                        <span className='text-[11px] text-gray-500'>{PURPOSE_LABEL[t.category] ?? t.category}</span>
                      )}
                    </>
                  }
                />
              ))}
            </MobileList>
          </div>
        </>
      )}

      <ReadyMessageDetailSheet
        template={liveDetail}
        onClose={() => setDetail(null)}
        onEdit={
          liveDetail && liveDetail.status === 'approved' && !hasPositionalPlaceholder(liveDetail.bodyText)
            ? (template) => {
                setDetail(null)
                setEditTarget(template)
                setCreateOpen(true)
              }
            : undefined
        }
        onRetry={
          liveDetail && liveDetail.status === 'rejected'
            ? (template) => {
                setDetail(null)
                setRetryTarget(template)
                setCreateOpen(true)
              }
            : undefined
        }
        onArchive={
          liveDetail &&
          (liveDetail.status === 'approved' || liveDetail.status === 'paused' || liveDetail.status === 'disabled')
            ? (template) => {
                setDetail(null)
                setConfirm({ kind: 'archive', template })
              }
            : undefined
        }
        onDiscard={
          liveDetail && (liveDetail.status === 'pending' || liveDetail.status === 'rejected')
            ? (template) => {
                setDetail(null)
                setConfirm({ kind: 'discard', template })
              }
            : undefined
        }
      />

      <ReadyMessageEditorMobile
        key={editTarget ? `edit-${editTarget.id}` : (retryTarget?.id ?? 'new')}
        open={createOpen}
        onClose={closeEditor}
        onCreate={handleCreate}
        heading={editTarget ? 'עריכת הודעה' : 'הודעה מוכנה חדשה'}
        submitLabel='שלח לבדיקה'
        note={editTarget ? EDIT_NOTE : undefined}
        initial={
          editTarget
            ? { displayTitle: editTarget.displayTitle, bodyText: editTarget.bodyText, purpose: editTarget.category }
            : retryTarget
              ? { displayTitle: retryTarget.displayTitle, bodyText: retryTarget.bodyText }
              : undefined
        }
      />

      <ConfirmSheet
        open={confirm?.kind === 'discard'}
        destructive
        title='מחיקת הודעה'
        msg={
          confirm
            ? `למחוק את "${readyMessageTitle(confirm.template.displayTitle)}"?\nההודעה תוסר ולא תהיה זמינה לשליחה.`
            : ''
        }
        confirmLbl='מחק'
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const id = confirm?.template.id
          setConfirm(null)
          if (id != null) await runDiscard(id)
        }}
      />
      <ConfirmSheet
        open={confirm?.kind === 'archive'}
        destructive
        title='העברה לארכיון'
        msg={
          confirm
            ? `להעביר את "${readyMessageTitle(confirm.template.displayTitle)}" לארכיון?\nההודעה לא תופיע ברשימה ולא תהיה זמינה לשליחה.`
            : ''
        }
        confirmLbl='העבר לארכיון'
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const id = confirm?.template.id
          setConfirm(null)
          if (id != null) await runArchive(id)
        }}
      />
    </div>
  )
}
