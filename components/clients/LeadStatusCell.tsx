'use client'

import React from 'react'
import { Select } from '@/lib/form'

export const STATUS_STYLES: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  new:       { label: 'חדש',     bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  contacted: { label: 'בטיפול',  bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', dot: 'bg-yellow-500' },
  interested:{ label: 'מעוניין', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500' },
  closed:    { label: 'סגור',    bg: 'bg-gray-100',  text: 'text-gray-600',   border: 'border-gray-200',   dot: 'bg-gray-400' },
  lost:      { label: 'אבוד',    bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200',    dot: 'bg-red-500' },
}

export const STATUS_OPTIONS = Object.entries(STATUS_STYLES).map(([value, { label }]) => ({ value, label }))

type Props = {
  status: string | null | undefined
  obj: any
  updatingId: number | null
  onStatusChange: (obj: any, newStatus: string) => void | Promise<void>
}

export default function LeadStatusCell({ status, obj, updatingId, onStatusChange }: Props) {
  const isUpdating = updatingId === obj.id
  const s = STATUS_STYLES[status ?? 'new'] || STATUS_STYLES.new
  return (
    <Select
      options={STATUS_OPTIONS}
      val='value'
      show='label'
      value={status ?? 'new'}
      required={false}
      className={`min-w-28 ${s.bg} ${s.text} ${s.border} ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}
      onChange={(e) => onStatusChange(obj, e.target.value)}
    />
  )
}
