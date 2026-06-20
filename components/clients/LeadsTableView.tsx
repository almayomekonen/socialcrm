'use client'

import React from 'react'
import Table, { ConfigT } from '@/lib/table'
import { STATUS_STYLES } from './LeadStatusCell'

type Props = {
  leads: boolean
  activeTab: string
  setActiveTab: (tab: string) => void
  filteredData: any[]
  mergedState: any[]
  config: ConfigT
  children?: React.ReactNode
  fillHeight?: boolean
}

export default function LeadsTableView({
  leads,
  activeTab,
  setActiveTab,
  filteredData,
  mergedState,
  config,
  children,
  fillHeight = false,
}: Props) {
  return (
    <>
      {leads && (
        <div className='flex gap-1 mb-3 border-b border-gray-200 shrink-0' dir='rtl'>
          {Object.entries(STATUS_STYLES).map(([key, { label, dot, text, bg, border }]) => {
            const count = mergedState.filter((l) => l.status === key).length
            const isActive = activeTab === key
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 -mb-px transition-colors
                    ${isActive
                      ? `${bg} ${text} ${border} bg-white`
                      : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-200 hover:bg-gray-50'
                    }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                {label}
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium
                    ${isActive ? `${text} opacity-70` : 'bg-gray-100 text-gray-500'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {children}
      <Table key={filteredData.length + '-' + activeTab} config={config} tblCls={fillHeight ? 'mb-0 tbl-fill' : 'mb-0'} />
    </>
  )
}
