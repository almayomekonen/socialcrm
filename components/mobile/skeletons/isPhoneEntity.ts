import { getDeviceClass } from '@/lib/device'

/**
 * Loading-UI branch: which ENTITY is this request.
 *
 * Uses the existing `getDeviceClass()` — does not redefine DeviceClass, does
 * not read rollout flags, does not touch auth. Route `loading.tsx` files call
 * this so a phone never receives a desktop table/grid skeleton and a laptop
 * never receives a mobile card skeleton (architecture-rules.md §9).
 */
export async function isPhoneEntity(): Promise<boolean> {
  return (await getDeviceClass()) === 'phone'
}
