import type { Metadata } from 'next'
import FilesTable from '@/components/files/FilesTable'
import { getFiles } from '@/db/files'
import { getUser } from '@/db/auth'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import React from 'react'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'

/** Tab title in the interface language — Hebrew ('קבצים') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('tasks.files.title') }
}

export default async function FilesPage() {
  /**
   * DESKTOP-ONLY SECTION. `FilesTable` is a desktop grid with no phone
   * presentation. The `getUser()` read exists only to supply the agency id the
   * rollout gate requires — it is the same session cookie every other page in
   * this app reads, and it returns before `getFiles()` so a phone runs no query
   * (architecture-rules.md §9).
   */
  const user = await getUser()
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='files' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)
  const files = await getFiles({ creatorName: true, clientName: true, taskTitle: true })
  let clients = files.map((file) => ({ id: file.clientId, name: file.clientName })).filter((c) => c.id && c.name) // remove null/undefined/empty

  clients = [...new Map(clients.map((c) => [c.id, c])).values()]

  return (
    <div className='flex flex-col min-h-0 h-full' {...regionAttrs(locale)}>
      <FilesTable data={files} tasks={[]} clients={clients} fillHeight key={Math.random()} />
    </div>
  )
}
