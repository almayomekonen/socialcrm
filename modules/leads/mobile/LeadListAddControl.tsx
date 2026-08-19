'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import { useSetMobileHeaderAction } from '@/components/mobile/MobileHeaderAction'
import LeadFormMobile from './LeadFormMobile'
import LeadImportMobile from './LeadImportMobile'
import LeadsAddSheet from './LeadsAddSheet'

type Sheet = null | 'chooser' | 'form' | 'import'

/**
 * Populated Leads add/import. Registers a header + (never a FAB) and opens
 * the existing form / import sheets — one at a time. Hidden while the list
 * is in selection so an add sheet cannot sit behind selection actions.
 */
export default function LeadListAddControl({ selecting }: { selecting: boolean }) {
  const router = useRouter()
  const setHeaderAction = useSetMobileHeaderAction()
  const [sheet, setSheet] = useState<Sheet>(null)

  const openChooser = useCallback(() => setSheet('chooser'), [])

  useEffect(() => {
    if (selecting) setSheet(null)
  }, [selecting])

  useLayoutEffect(() => {
    if (selecting) {
      setHeaderAction(null)
      return
    }
    setHeaderAction(<LeadsAddButton onClick={openChooser} />)
    return () => setHeaderAction(null)
  }, [selecting, openChooser, setHeaderAction])

  return (
    <>
      <LeadsAddSheet
        open={sheet === 'chooser'}
        onClose={() => setSheet(null)}
        onAdd={() => setSheet('form')}
        onImport={() => setSheet('import')}
      />
      {sheet === 'form' && (
        <LeadFormMobile
          open
          onClose={() => setSheet(null)}
          onCreated={(leadId) => {
            setSheet(null)
            router.push(`/clients/${leadId}/summary`)
          }}
        />
      )}
      {sheet === 'import' && <LeadImportMobile open onClose={() => setSheet(null)} />}
    </>
  )
}

function LeadsAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      data-testid='leads-add-action'
      aria-label='הוספת ליד'
      aria-haspopup='dialog'
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      className='flex size-11 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      <Icon name='plus' type='sol' className='size-4 bg-ink' />
    </button>
  )
}
