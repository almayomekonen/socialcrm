'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Table, { type ConfigT } from '@/lib/table'
import type { RecoveryAlertView } from '@/db/recoveryAlerts'

const STATUS_LABEL: Record<RecoveryAlertView['status'], string> = {
  open: 'ממתין לטיפול',
  resolved: 'טופל',
}

export default function RecoveryAlertsTable({ alerts }: { alerts: RecoveryAlertView[] }) {
  const router = useRouter()
  const [columns, setColumns] = useState<{ key: string; label: string; format?: string }[]>([
    { key: 'leadName', label: 'ליד' },
    { key: 'waitingMinutes', label: 'דקות המתנה' },
    { key: 'lastCustomerMessage', label: 'הודעה אחרונה מהליד' },
    { key: 'createdAt', label: 'נוצר', format: 'formatDateTime' },
    { key: 'statusLabel', label: 'סטטוס' },
  ])

  // Derive display rows (status → Hebrew label) without mutating props.
  const [rows, setRows] = useState(
    alerts.map((a) => ({ ...a, statusLabel: STATUS_LABEL[a.status] })),
  )

  const config: ConfigT = {
    tblId: 'recoveryAlertsTable',
    state: rows,
    setState: setRows,
    columns,
    setColumns,
    data: rows,
    noCheckboxs: true,
    onRowClick: (a) => router.push(`/leads?clientId=${a.leadId}`),
    emptyState: <div className='p-6 text-center text-muted'>אין התראות פתוחות — הכול תחת שליטה</div>,
  }

  return <Table config={config} tblCls='mb-0 tbl-fill' />
}
