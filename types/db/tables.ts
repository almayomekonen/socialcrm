export type Json = any
export type Role = 'ADMIN' | 'MNGR' | 'AGNT' | 'OFFICE' | 'GM' | 'EXT'
export type FamilyStatus = 'רווק' | 'רווקה' | 'נשוי' | 'נשואה' | 'גרוש' | 'גרושה' | 'אלמן' | 'אלמנה'
export type Gender = 'זכר' | 'נקבה'
export type HebrewRole = 'אדמין' | 'נציג' | 'מנהל' | 'מתפעל'
export type TagmulType = 'היקף' | 'נפרעים'

export interface TaskItem {
  title: string
  isCompleted: boolean
  subTasks: {
    desc: string
    title: string
    isCompleted: boolean
  }[]
}

export interface TaskNote {
  userName: string
  content: string
  createdAt: Date
}

export interface File {
  path: string
  name: string
  type: string
  size: number
  url: string
  clientId: number | null
  taskId: number | null
  createdById: number
  createdAt: Date
  agencyId?: number
}

export interface UserOtp {
  token: string
  tokenExpiry: Date
}

export interface Address {
  city: string
  street: string
  houseNum: string
  zip: string
}
export interface JobContactInfo {
  phone: string
  mail: string
  fax: string
}
type Job = {
  address: Address | null
  employer: string | null
  profession: string | null
  status: string | null
  salary: number | null
  bizId: string | null
  startDate: Date | null
  contactInfo: JobContactInfo | null
}

export interface User {
  id: number
  idNum: string | null
  firstName: string
  lastName: string | null
  email: string
  phone: string | null
  role: Role
  gglName: string | null
  gglSub: string | null
  picture: string | null
  suspended: boolean
  createdAt: Date
  updatedAt: Date
  tblPref: Json | null
  favSaleIds: number[]
  goals: Json | null
  savedFilters: Json | null
  favClientIds: number[]
  name: string
  otp: UserOtp | null
  createdById: number
  agencyId: number
}

export interface UserPerm {
  gaveId: number
  gotId: number
}

export interface Team {
  id: number
  name: string
  createdAt: Date | null
  updatedAt: Date | null
  agencyId: number
}

export interface UserTeam {
  userId: number
  teamId: number
  type: 'user' | 'mngr'
}

export interface UserInfo {
  id: number
  fax: string | null
  officePhone: string | null
  agentLicenseNum: string | null
  agentLicenseType: string | null
  agentLicenseName: string | null
  agentLicenseFiles: number[] | null
  logoutMinutes: number
  ips: Json[]
  tifulEmail: string | null
}

export interface Agency {
  id: number
  name: string
  img: number | File | null
  pkg: string | null
  plan: 'free' | 'pro'
  planReason: string | null
  trialStartedAt: Date | null
  trialEndsAt: Date | null
  trialExempt: boolean
  autoResponseEnabled: boolean
  onboardingCompletedAt: Date | null
}

export interface Invitation {
  id: number
  email: string
  token: string
  role: Role
  firstName: string
  lastName: string
  phone: string | null
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED'
  createdAt: Date
  expiresAt: Date
  createdById: number
  agencyId: number
}

export interface DefaultSettings {
  id: number
  userId: number
  bronze: string
  gold: string
  monthsLidimSheloHufku: string
  isBituachHaimMutzarHaser: boolean
  monthsUpdated: string
  isRiskUpdated: boolean
  isMahalotKashotUpdated: boolean
}
export interface Lead {
  id: number
  firstName: string
  lastName: string
  idNum: string
  idNumDate: Date | null
  createdById: number
  name: string
  details: string
  rank: number | null
  status: string | null
  email: string | null
  phone: string | null
  secPhone: string | null
  handlerId: number | null
  birthDate: Date | null
  gender: Gender | null
  familyStatus: FamilyStatus | null
  leadSource: string | null
  passportNum: string | null
  licenseNum: string | null
  familyId: number | null
  createdAt: Date | null
  updatedAt: Date | null
  userId: number | null
  agencyId: number
  lead: boolean
  overQuota: boolean
  statusChangedAt: Date
  lastActivityAt: Date | null
  lastOutcomeType: string | null
  nextFollowUpAt: Date | null
  followUpNote: string | null
  state?: 'updated' | 'cold' | null
  priority?: number
  overdueRatio?: number | null
  slaRemainingHours?: number | null
  severity?: 1 | 2 | 3 | null
  isNewBadge?: boolean
  nextAction?: string | null
}

export interface LeadInfo {
  id: number
  idFiles: number[] | null
  countryOfBirth: string | null
  isAmericanCitizen: boolean
  isGreenCard: boolean
  city: string | null
  street: string | null
  houseNum: string | null
  zip: string | null
  job: Job | null
  ipuyFiles: Json | null
}

export interface Deal {
  id?: number
  status?: string
  action?: string | null
  company?: string
  branch?: string
  prdct?: string
  prdctType?: string
  saleDt?: Date | null
  offrDt?: Date
  clientId?: number
  createdAt?: Date | null
  updatedAt?: Date | null
  createdById?: number
  notes?: string | null
  favSalesId?: number | null
  amount?: number
  cmsn?: number | null
  isUpgrade?: boolean
  handlerId?: number | null
  bonus?: boolean
  leadSource?: string | null
  annualValue?: number | null
  agencyId?: number
}

export interface DealUsers {
  id: number
  saleId: number
  userId: number
  amount: number
  prcnt: number
  cmsn: number | null
  tfuca: number | null
}

export interface CmsnRule {
  id: number
  branch: string
  createdAt: Date | null
  updatedAt: Date | null
  companies: string[] | null
  prdctTypes: string[] | null
  prdcts: string[] | null
  cmsnRate: number
  agencyId: number
}

export interface DeletedDeal {
  id: number
  createdAt: Date | null
  updatedAt: Date | null
  deletedById: number
  sale: Json
}

export interface Promo {
  id: number
  title: string
  desc: string
  createdAt: Date | null
  updatedAt: Date | null
  end: Date
  start: Date
  img: number | null
  goals: Json
  userIds: number[] | null
  grpIds: number[] | null
  isPromoGrp: boolean
  promoGrps: Json | null
  files: number[]
  agencyId: number
}

export interface LeadList {
  id: number
  userId: number
  title: string
  clientIds: number[]
}

export interface Contract {
  id: number
  name: string
  type: string
  createdAt: Date | null
  updatedAt: Date | null
  agencyId: number
  userIds: number[]
  mngrId: number | null
}

export interface ContractPrdct {
  id: number
  contractId: number | null
  branch: string | null
  prdcts: string[] | null
  prdctTypes: string[] | null
  companies: string[] | null
  prcnt: number | null
  fromAmount: number | null
  createdAt: Date | null
  updatedAt: Date | null
  tagmulType: TagmulType
}

export interface TaskTmplt {
  id: number
  title: string
  tasks: TaskItem[]
  notes: TaskNote[]
  createdAt: Date | null
  updatedAt: Date | null
  files: number[]
  agencyId: number
}

export interface Task {
  id: number
  clientId: number
  userId: number | null
  title: string
  status: string | null
  tmpltId: number | null
  dueDate: Date | string | null
  createdAt: Date | null
  updatedAt: Date | null
  completed: boolean
  tasks: TaskItem[]
  notes: TaskNote[]
  files: number[]
}

export interface GroupPerm {
  coalesce: number[] | null
}

export interface Total {
  json_build_object: Json | null
}

export interface AllUsersView {
  id: number
  name: string
  role: Role
  email: string
  suspended: boolean | null
}

export interface FlatDealsView {
  userId: number | null
  name: string | null
  cmsn: number | null
  branch: string | null
  prdctType: string | null
  amount: number | null
  company: string | null
  status: string | null
  offrDt: Date | null
  action: string | null
  prdct: string | null
  isUpgrade: boolean | null
  clientId: number | null
  annualValue: number | null
}

export interface TeamsView {
  id: number
  name: string
  userIds: number[]
  mngrIds: number[]
  officeIds: number[]
  updatedAt: Date | null
  agencyId: number
  users: { id: number; name: string }[] | null
  mngrs: { id: number; name: string }[] | null
  offices: { id: number; name: string }[] | null
}

export interface DealsView {
  id: number
  offrDt: Date
  clientData: string | null
  userName: string | null
  status: string
  action: string | null
  company: string
  branch: string
  prdct: string
  prdctType: string
  saleDt: Date | null
  amount: number
  cmsn: number | null
  notes: string | null
  bonus: boolean
  userId: number
  user2Id: number | null
  annualValue: number | null
  userIds: number[]
  updatedAt: Date | null
  clientId: number
  handlerName: string | null
  handlerId: number | null
  isUpgrade: boolean
  leadSource: string | null
  bizNum: string | null
  bizName: string | null
}

export interface AnalyticsEvent {
  id: number
  agencyId: number
  userId: number | null
  event: string
  props: Json
  createdAt: Date
}

export interface TrialStatusView {
  agencyId: number
  agencyName: string
  plan: 'free' | 'pro'
  trialExempt: boolean
  trialStartedAt: Date | null
  trialEndsAt: Date | null
  status: 'PAID' | 'LEGACY' | 'NEVER_STARTED' | 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED'
  daysRemaining: number | null
}
