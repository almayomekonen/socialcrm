// Today brief — the completeness verdict (INV-9, INV-10). Pure. "covered" is
// asserted iff there is no outstanding work AND the data is fresh; the permission
// claim is always channel-scoped (no unscoped value exists in the type).

import type { PermissionVerdict, StatusVerdict } from './types'

export function completenessVerdict({
  remaining,
  dataFresh,
}: {
  remaining: number
  dataFresh: boolean
}): { statusVerdict: StatusVerdict; permissionVerdict: PermissionVerdict } {
  const allClear = remaining === 0 && dataFresh
  const statusVerdict: StatusVerdict = remaining > 0 ? 'active' : dataFresh ? 'covered' : 'unconfirmed'
  const permissionVerdict: PermissionVerdict = allClear ? 'scoped_all_clear' : 'scoped_partial'
  return { statusVerdict, permissionVerdict }
}
