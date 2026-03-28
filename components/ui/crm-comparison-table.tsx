'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Icon from '@/lib/Icon'
import { cn } from '@/lib/utils'

type CellStatus = 'good' | 'bad' | 'partial'

type ComparisonRow = {
  id: string
  feature: string
  category: string
  excel: { status: CellStatus; label: string }
  crm: { status: CellStatus; label: string }
}

const ROWS: ComparisonRow[] = [
  { id: '1', feature: 'ייבוא לידים מפייסבוק', category: 'לידים', excel: { status: 'bad', label: 'ידני בלבד' }, crm: { status: 'good', label: 'אוטומטי' } },
  { id: '2', feature: 'ייבוא לידים מאינסטגרם', category: 'לידים', excel: { status: 'bad', label: 'ידני בלבד' }, crm: { status: 'good', label: 'אוטומטי' } },
  { id: '3', feature: 'ייבוא מקובץ אקסל קיים', category: 'לידים', excel: { status: 'good', label: 'כן' }, crm: { status: 'good', label: 'כן' } },
  { id: '4', feature: 'הוספת ליד ידנית', category: 'לידים', excel: { status: 'partial', label: 'מסורבל' }, crm: { status: 'good', label: '10 שניות' } },
  { id: '5', feature: 'מניעת כפילויות', category: 'לידים', excel: { status: 'bad', label: 'לא' }, crm: { status: 'good', label: 'אוטומטי' } },
  { id: '6', feature: 'עדכון סטטוס ליד', category: 'ניהול', excel: { status: 'partial', label: 'ידני' }, crm: { status: 'good', label: 'בקליק' } },
  { id: '7', feature: 'הוספת הערות לליד', category: 'ניהול', excel: { status: 'partial', label: 'בתוך תא' }, crm: { status: 'good', label: 'עם היסטוריה' } },
  { id: '8', feature: 'תזכורות ומעקב', category: 'ניהול', excel: { status: 'bad', label: 'לא' }, crm: { status: 'good', label: 'כן' } },
  { id: '9', feature: 'חיפוש וסינון מהיר', category: 'ניהול', excel: { status: 'partial', label: 'בסיסי' }, crm: { status: 'good', label: 'מלא' } },
  { id: '10', feature: 'גישה ממובייל', category: 'ניהול', excel: { status: 'partial', label: 'מוגבל' }, crm: { status: 'good', label: 'כן' } },
  { id: '11', feature: 'שיוך ליד לנציג', category: 'צוות', excel: { status: 'bad', label: 'לא' }, crm: { status: 'good', label: 'כן' } },
  { id: '12', feature: 'נציג רואה רק את שלו', category: 'צוות', excel: { status: 'bad', label: 'לא' }, crm: { status: 'good', label: 'כן' } },
  { id: '13', feature: 'מנהל רואה את כולם', category: 'צוות', excel: { status: 'partial', label: 'ידנית' }, crm: { status: 'good', label: 'כן' } },
  { id: '14', feature: 'אחוז סגירה לפי מקור', category: 'ביצועים', excel: { status: 'bad', label: 'לא' }, crm: { status: 'good', label: 'כן' } },
  { id: '15', feature: 'ביצועי נציגים', category: 'ביצועים', excel: { status: 'bad', label: 'לא' }, crm: { status: 'good', label: 'כן' } },
  { id: '16', feature: 'דוחות חודשיים', category: 'ביצועים', excel: { status: 'bad', label: 'לא' }, crm: { status: 'good', label: 'כן' } },
]

const CATEGORIES = ['הכל', 'לידים', 'ניהול', 'צוות', 'ביצועים']

const CATEGORY_COLORS: Record<string, string> = {
  'לידים': 'bg-blue-50 text-blue-700 border-blue-200',
  'ניהול': 'bg-purple-50 text-purple-700 border-purple-200',
  'צוות': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'ביצועים': 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function StatusBadge({ status, label }: { status: CellStatus; label: string }) {
  if (status === 'good') {
    return (
      <span className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200 whitespace-nowrap'>
        <Icon name='circle-check' className='size-3.5 bg-green-600' />
        {label}
      </span>
    )
  }
  if (status === 'bad') {
    return (
      <span className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200 whitespace-nowrap'>
        <Icon name='xmark' className='size-3.5 bg-red-500' />
        {label}
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap'>
      <span className='text-amber-500 font-bold leading-none'>~</span>
      {label}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={cn(
        'inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap',
        CATEGORY_COLORS[category] ?? 'bg-gray-50 text-gray-600 border-gray-200',
      )}
    >
      {category}
    </span>
  )
}

export function CRMComparisonTable() {
  const [activeCategory, setActiveCategory] = useState('הכל')

  const filtered = activeCategory === 'הכל' ? ROWS : ROWS.filter((r) => r.category === activeCategory)

  return (
    <div className='w-full max-w-5xl mx-auto px-4 py-16' dir='rtl'>
      {/* Section header */}
      <div className='mb-10 text-center'>
        <p className='text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2'>השוואה מלאה</p>
        <h2 className='text-3xl font-bold text-gray-900 mb-3'>vs SocialCRM אקסל תכונה אחרי תכונה</h2>
        <p className='text-gray-500 max-w-xl mx-auto'>16 נקודות השוואה שיגידו לך בדיוק איפה אקסל נשבר</p>
      </div>

      {/* Category filter */}
      <div className='flex flex-wrap gap-2 mb-6 justify-center'>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium border transition-all',
              activeCategory === cat
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400',
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className='border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm'>
        <Table>
          <TableHeader>
            <TableRow className='bg-gray-50 border-b border-gray-200 hover:bg-gray-50'>
              <TableHead className='font-semibold text-gray-600 text-right'>פיצ&apos;ר</TableHead>
              <TableHead className='font-semibold text-gray-600 text-right'>קטגוריה</TableHead>
              <TableHead className='font-semibold text-gray-600 text-center'>אקסל</TableHead>
              <TableHead className='font-semibold text-gray-600 text-center'>SocialCRM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence mode='popLayout' initial={false}>
              {filtered.map((row, i) => (
                <motion.tr
                  key={row.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, delay: i * 0.025 }}
                  className='border-b border-gray-100 hover:bg-gray-50/70 transition-colors'
                >
                  <td className='px-4 py-4 font-medium text-gray-900 text-sm whitespace-nowrap'>{row.feature}</td>
                  <td className='px-4 py-4'><CategoryBadge category={row.category} /></td>
                  <td className='px-4 py-4 text-center'><StatusBadge status={row.excel.status} label={row.excel.label} /></td>
                  <td className='px-4 py-4 text-center'><StatusBadge status={row.crm.status} label={row.crm.label} /></td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </TableBody>
        </Table>
      </div>

      {/* Legend */}
      <div className='flex gap-4 mt-4 justify-center flex-wrap'>
        <span className='inline-flex items-center gap-1.5 text-xs text-gray-500'>
          <span className='size-2 rounded-full bg-green-500 inline-block' /> קיים ועובד מצוין
        </span>
        <span className='inline-flex items-center gap-1.5 text-xs text-gray-500'>
          <span className='size-2 rounded-full bg-amber-400 inline-block' /> קיים באופן חלקי
        </span>
        <span className='inline-flex items-center gap-1.5 text-xs text-gray-500'>
          <span className='size-2 rounded-full bg-red-400 inline-block' /> לא קיים
        </span>
      </div>
    </div>
  )
}
