import { db } from '@/config/db'

/**
 * What the marketplace created, and from which version.
 *
 * Read-only as far as the engine is concerned — nothing in the execution path
 * touches this table. It exists so the marketplace can answer three questions:
 * what have I installed, is a newer version available, and which automations
 * would "uninstall" remove.
 */

export type InstallRecord = {
  id: number
  templateKey: string
  templateVersion: number
  automationId: number
  installedAt: string
}

export function installsQuery(agencyId: number) {
  return (
    db('automation_template_installs as i')
      .join('automation_definitions as d', 'd.id', 'i.automationId')
      .select('i.id', 'i.templateKey', 'i.templateVersion', 'i.automationId', 'i.installedAt')
      .where('i.agencyId', agencyId)
      // A soft-deleted automation is gone from the customer's point of view, so
      // it is gone from the marketplace's too — the template reads as
      // uninstalled and can be installed again.
      .whereNot('d.status', 'deleted')
      .orderBy('i.id')
  )
}

export async function listInstalls(agencyId: number): Promise<InstallRecord[]> {
  const rows = (await installsQuery(agencyId)) as (InstallRecord & { installedAt: Date | string })[]
  return rows.map((r) => ({ ...r, installedAt: new Date(r.installedAt).toISOString() }))
}

export async function recordInstall(input: {
  agencyId: number
  templateKey: string
  templateVersion: number
  automationId: number
  installedByUserId: number
}): Promise<void> {
  await db('automation_template_installs').insert(input)
}

/** The automation ids one template created for this agency. */
export async function installedAutomationIds(agencyId: number, templateKey: string): Promise<number[]> {
  const rows = (await installsQuery(agencyId).where('i.templateKey', templateKey)) as { automationId: number }[]
  return rows.map((r) => Number(r.automationId))
}
