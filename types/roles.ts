export const MapRoles = {
  AGNT: 'נציג מכירות',
  MNGR: 'מנהל',
  OFFICE: 'תפעול',
  ADMIN: 'אדמין',
  GM: 'מנהל כללי',
  EXT: 'שותף חיצוני',
}

export const HE_ROLES = {
  'נציג מכירות': 'AGNT',
  מנהל: 'MNGR',
  תפעול: 'OFFICE',
  אדמין: 'ADMIN',
  'מנהל כללי': 'GM',
  // 'שותף חיצוני': 'EXT',
}

export enum Roles {
  ADMIN = 'ADMIN',
  MNGR = 'MNGR',
  AGNT = 'AGNT',
  OFFICE = 'OFFICE',
  GM = 'GM',
  EXT = 'EXT',
}

const _mngr = new Set([Roles.MNGR, Roles.ADMIN, Roles.GM])
export const isMngr = (role: Roles) => _mngr.has(role)

const _asAdmin = new Set([Roles.ADMIN, Roles.GM])
export const isAdmin = (role: Roles) => _asAdmin.has(role)

const _asAdminExtOffice = new Set([Roles.ADMIN, Roles.GM, Roles.EXT, Roles.OFFICE])
export const isAdminExtOffice = (role: Roles) => _asAdminExtOffice.has(role)

const _asAgentMngr = new Set([Roles.AGNT, Roles.MNGR])
export const isAgentOrMngr = (role: Roles) => _asAgentMngr.has(role)

export const isAgent = (role: Roles) => role === Roles.AGNT

const _asExtOffice = new Set([Roles.EXT, Roles.OFFICE])
export const isExtOffice = (role: Roles) => _asExtOffice.has(role)

export const rolesOpt = [
  { id: 'AGNT', name: MapRoles.AGNT },
  { id: 'MNGR', name: MapRoles.MNGR },
  { id: 'ADMIN', name: MapRoles.ADMIN },
  { id: 'GM', name: MapRoles.GM },
  { id: 'OFFICE', name: MapRoles.OFFICE },
]
