import { getDeviceClass } from '@/lib/device'

/**
 * Server-only entity check for non-loading UI.
 *
 * Do not call this from `loading.tsx`. Awaiting `headers()` there makes the
 * App Router fallback a dynamic Cache Components hole; client navigation can
 * then leave the skeleton mounted after the destination RSC has already 200'd.
 * Loading files use `EntityLoading` / the mounted `MobileWorkspaceShell` instead.
 */
export async function isPhoneEntity(): Promise<boolean> {
  return (await getDeviceClass()) === 'phone'
}
