import ClientFilesTable from '@/components/files/ClientFilesTable'
import LeadDriveSection from '@/components/clientPage/LeadDriveSection'
import { getFilesByClientId } from '@/db/files'
import { getTasksByClientId } from '@/db/tasks'
import { listLeadDriveAttachments } from '@/actions/leadDriveFiles'
import { fetchSuggestedDriveFiles } from '@/actions/leadDriveFilesSearch'
import { isDrivePickerEnabled } from '@/lib/integrations/google/picker/pickerCore'
import { getUser } from '@/db/auth'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { Metadata } from 'next'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'

/** Tab title in the interface language — Hebrew ('נתוני ליד', the lead layout's title) outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('leadDetail.page.title'), description: t('leadDetail.page.description') }
}

export default async function page({ params, searchParams }) {
  searchParams = await searchParams
  const { clientId } = await params

  /**
   * DESKTOP-ONLY LEAD TAB. Returned before the file/task/Drive reads, so a phone
   * triggers none of them — including the Google Drive round-trips
   * (architecture-rules.md §9).
   */
  const user = await getUser()
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='lead_files' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)
  const tasks = await getTasksByClientId(clientId)
  const files = await getFilesByClientId(clientId)

  // Drive section data — fail-soft: if either source throws (no connection,
  // Drive API error), the section still renders with empty arrays.
  // When the Picker is enabled, whole-Drive suggestions are not shown, so skip
  // the (restricted-scope) fetch entirely. Flag off = unchanged behaviour.
  const pickerEnabled = isDrivePickerEnabled()
  const [driveAttachments, driveSuggestions] = await Promise.all([
    listLeadDriveAttachments(clientId).catch(() => []),
    pickerEnabled ? Promise.resolve([]) : fetchSuggestedDriveFiles(clientId).catch(() => []),
  ])

  return (
    <div className='grid gap-4' {...regionAttrs(locale)}>
      <LeadDriveSection
        leadId={Number(clientId)}
        attachments={driveAttachments}
        suggestions={driveSuggestions}
        pickerEnabled={pickerEnabled}
      />
      <ClientFilesTable clientId={clientId} data={files} tasks={tasks} key={Math.random()} />
    </div>
  )
}
