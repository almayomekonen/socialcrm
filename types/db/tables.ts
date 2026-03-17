// define Json as any to avoid type errors
export type Json = any // string | number | boolean | null | { [key: string]: Json } | Json[]

// --------------------------------------------------
// ENUMS
// --------------------------------------------------

export type Role = 'ADMIN' | 'MNGR' | 'AGNT' | 'OFFICE' | 'GM' | 'EXT'
export type FamilyStatus = 'רווק' | 'רווקה' | 'נשוי' | 'נשואה' | 'גרוש' | 'גרושה' | 'אלמן' | 'אלמנה'
export type Gender = 'זכר' | 'נקבה'
export type HebrewRole = 'אדמין' | 'סוכן' | 'מנהל' | 'מתפעל' // Different from the system `Role`
export type TagmulType = 'היקף' | 'נפרעים'
export type QnaType = 'RISK' | 'GEN' // Changed to CAPITALIZED

// --------------------------------------------------
// JSONS
// --------------------------------------------------

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

export interface HealthStatus {
  kupatHolim: string
  shaban: string
  height: number
  weight: number
  bmi: number
  smoker: boolean
  cigarettesPerDay: number
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
export interface Heir {
  relationType: string
  firstName: string
  lastName: string
  idNum: string
  birthDate: Date
  gender: Gender
  city: string
  street: string
  houseNum: string
  zip: string
  prcnt: number
}

export interface RequestedSum {
  type: string
  crnt: number
  ideal: string
}

export interface Ip {
  ip: string
  date: Date
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

// --------------------------------------------------
// Tables
// --------------------------------------------------

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
  suspended: boolean // defaultTo implies it will likely be present
  createdAt: Date
  updatedAt: Date
  tblPref: Json | null
  favSaleIds: number[]
  goals: Json | null
  savedFilters: Json | null
  favClientIds: number[]
  name: string // Generated column
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
  achuzHafkadaPensia: string
  achuzDmeiNihulKupatGemelTzvira: string
  achuzDmeiNihulKupatGemelHafkada: string
  achuzDmeiNihulKerenHishtalmutTzvira: string
  achuzDmeiNihulKerenHishtalmutHafkada: string
  achuzDmeiNihulPensiaTzvira: string
  achuzDmeiNihulPensiaHafkada: string
  achuzDmeiNihulMenahalimTzvira: string
  monthsLoButzaPgishatSherutTkufatit: string
  achuzKfitzatPremiaBitucheiPrat: string
  monthsLidimSheloHufku: string
  schumKerenHishtalmutHafkadaAtzmaiLeloHafkada: string
  achuzPensiaHafkadaAtzmaiLeloHafkada: string
  isBituachHaimMutzarHaser: boolean
  isBituachBriutMutzarHaser: boolean
  isMahalotKashotMutzarHaser: boolean
  isGemelLehashkaaMutzarHaser: boolean
  monthsMutzarKayam: string
  isRiskMutzarKayam: boolean
  isMahalotKashotMutzarKayam: boolean
}
export interface Client {
  id: number
  firstName: string
  lastName: string
  idNum: string
  idNumDate: Date | null
  createdById: number
  name: string // Generated column
  details: string // Generated column
  rank: number | null // decimal is number in JS
  status: boolean
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
}

export interface ClientsInfo {
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
  healthStatus: HealthStatus | null
  dangerousHobbies: string[] | null
  heirs: Heir[] | null
  generalGoals: string[] | null
  savingGoals: string[] | null
  insuranceGoals: string[] | null
  ipuyFiles: Json | null
}

export interface Qna {
  clientId: number
  q: string
  a: string
  desc: string
  type: QnaType
}

export interface Savings {
  id: number
  clientId: number
  sikum: Json | null
  tzvirot: Json | null
  itrotLefiTkufa: Json[] | null
  kisuim: Json[] | null
  mutavimSheerim: Json[] | null
  tviot: Json[] | null
  mitryot: Json[] | null
  maasikim: Json[] | null
  pirteiKisuiKerenPensia: Json[] | null
  gilPrisha: Json | null
  tsua: Json | null
  halvaot: Json[] | null
  masluleiHashkaa: Json[] | null
  hafkadot: Json[] | null
  mutavim: Json[] | null
  gvia: Json | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface Bituchim {
  id: number
  clientId: number
  polisa: string | null
  mutzar: string | null
  sugMutzar: string | null
  status: boolean | null
  taarichTchilatBituach: Date | null
  taarichSiumBituach: Date | null
  tkufatBituach: string | null
  mevutach: string | null
  hevra: string | null
  schumBituach: number | null
  sugPremia: string | null
  premia: number | null
  meashen: boolean | null
  tosafot: string | null
  taarichNechonut: Date | null
  tz: string | null
  anaf: string | null
  sivug: string | null
  kisuim: Json[] | null
  createdAt: Date
  updatedAt: Date
}

export interface Sale {
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
  contractNum?: string | null
  contractEndDate?: Date | null
  isRenewal?: boolean
  isUpgrade?: boolean
  handlerId?: number | null
  bonus?: boolean
  leadSource?: string | null
  annualValue?: number | null
  agencyId?: number
}

export interface SaleUsers {
  id: number
  saleId: number
  userId: number
  amount: number
  prcnt: number
  cmsn: number | null
  tfuca: number | null
  monthlyCmsn: number | null
  yearlyCmsn: number | null
  agencyMonthlyCmsn: number | null
  agencyYearlyCmsn: number | null
  mngrMonthlyCmsn: number | null
  mngrYearlyCmsn: number | null
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

export interface DeletedSale {
  id: number
  createdAt: Date | null
  updatedAt: Date | null
  deletedById: number
  sale: Json // contains the full sale object as JSON
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

export interface ClientList {
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

// --------------------------------------------------
// Views
// --------------------------------------------------

export interface AllUsersView {
  id: number
  name: string
  role: Role
  email: string
  suspended: boolean | null
}

export interface FlatSalesView {
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
  userMonthlyCmsn: number | null
  userYearlyCmsn: number | null
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

export interface SalesView {
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
  isRenewal: boolean
  contractEndDate: Date | null
  annualValue: number | null
  userIds: number[]
  contractNum: string | null
  updatedAt: Date | null
  clientId: number
  handlerName: string | null
  handlerId: number | null
  isUpgrade: boolean
  leadSource: string | null
  yearlyCmsn: number | null
  monthlyCmsn: number | null
  userYearlyCmsn: number | null
  userMonthlyCmsn: number | null
  mngrYearlyCmsn: number | null
  mngrMonthlyCmsn: number | null
  bizNum: string | null
  bizName: string | null
}
