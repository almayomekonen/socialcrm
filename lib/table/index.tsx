'use client'

import React, { ReactNode } from 'react'
import THead from './THead'
import TBody from './TBody'

export default function Table({ config, tblCls = '' }: { config: ConfigT; tblCls?: string }) {
  return (
    <div className={`tbl ${tblCls}`} id={config.tblId}>
      <table>
        <THead config={config} />
        <TBody config={config} />
      </table>
    </div>
  )
}

export type ConfigT = {
  tblId?: string
  state: any[]
  setState: React.Dispatch<React.SetStateAction<any[]>>
  columns: {
    key: string
    label: string
    format?: 'formatDate' | 'formatCurrency' | 'formatDateTime' | 'formatPrecent' | 'formatShortCurrency' | string
    noShow?: boolean
  }[]
  setColumns: (headers: { key: string; label: string; format?: string }[]) => void
  /**
   * Presentation-only overlay: keys force-hidden at render (header, body, and the
   * ShowColumns selector), regardless of the user's saved noShow preference. Never
   * mutates `columns` or persistence — used for availability-gated optional columns.
   */
  hiddenKeys?: Set<string>
  data?: any[]
  onRowClick?: (item: any) => void
  noCheckboxs?: boolean
  moreRows?: (item: any, index: number) => ReactNode
  moreHeads?: () => ReactNode
  withIndex?: boolean
  getColumns?: (tblId?: string, columns?: { key: string; label: string; format?: string }[]) => void
  funcs?: { [key: string]: (value?: any, item?: any) => any }
  addTrCls?: (item: any) => string
  clsBody?: string
  clsHead?: string
  skeleton?: boolean
  emptyState?: ReactNode
}
