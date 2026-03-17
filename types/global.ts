import { Knex } from 'knex'

export interface WithSql {
  sql: Knex.QueryBuilder
  [key: string]: any
}

export type Promo = {
  id: number
  title: string
  desc: string
  start: string
  end: string
  img: string
  goals: any
  grpIds: number[]
  userIds: number[]
  isPromoGrp: boolean
}

export type CalcContResType = {
  user: {
    monthlyCmsn: number
    yearlyCmsn: number
    mngrMonthlyCmsn?: number
    mngrYearlyCmsn?: number
    agencyMonthlyCmsn?: number
    agencyYearlyCmsn?: number
  }
  user2?: {
    monthlyCmsn: number
    yearlyCmsn: number
    mngrMonthlyCmsn?: number
    mngrYearlyCmsn?: number
    agencyMonthlyCmsn?: number
    agencyYearlyCmsn?: number
  }
}
