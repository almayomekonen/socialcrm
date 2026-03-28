'use client'

import React from 'react'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'

interface HeroContentData {
  subheadline: string
  headline: string
  description: string
  secondaryCtaText: string
  secondaryCtaLink: string
  primaryCtaText: string
  primaryCtaLink: string
}

interface AppPreviewFilter {
  label: string
  icon?: string
  dropdown?: boolean
}

interface AppPreviewAction {
  type: 'button-outline' | 'button-primary'
  text: string
  icon?: string
  href?: string
}

interface AppPreviewHeaderControlsData {
  filters: AppPreviewFilter[]
  actions: AppPreviewAction[]
}

interface AppDataTableHeader {
  id: string
  label: string
  icon?: string
}

interface AppDataTableRow {
  id?: number
  name: string
  assignee: string[]
  status: string
  dueDate: string
  project: string
  statusColor: string
  phone?: string
}

interface AppDataTableData {
  headers: AppDataTableHeader[]
  data: AppDataTableRow[]
}

interface AppPreviewData {
  headerControls: AppPreviewHeaderControlsData
  appDataTable: AppDataTableData
}

export interface HeroSectionComponentData {
  heroContent: HeroContentData
  appPreview: AppPreviewData
}

const AbstractBackground: React.FC = () => {
  return (
    <div>
      <div className='absolute inset-0 bg-linear-to-br from-transparent via-transparent to-blue-700 opacity-50 z-0' />
      <div className='absolute bottom-0 right-0 w-3/4 h-3/4 bg-blue-600 transform origin-bottom-right rotate-12 translate-y-1/3 -translate-x-1/4 opacity-90 z-0' />
      <div className='absolute bottom-0 left-0 w-1/2 h-1/2 bg-blue-700 opacity-80 z-0' />
      <div className='absolute top-0 left-0 w-1/2 h-full bg-blue-400 transform -skew-y-6 origin-top-left -translate-y-1/4 opacity-30 z-0' />
    </div>
  )
}


const HeroContent: React.FC<HeroContentData> = ({
  subheadline,
  headline,
  description,
  primaryCtaText,
  primaryCtaLink,
  secondaryCtaText,
  secondaryCtaLink,
}) => {
  return (
    <div className='flex flex-col items-center text-center p-8 lg:px-12 lg:pt-8' dir='rtl'>
      <div className='w-full max-w-2xl'>
        {subheadline && <p className='text-sm text-gray-600 mb-4'>{subheadline}</p>}
        <h1 className='text-4xl md:text-[57px] font-bold text-gray-900 mb-6 leading-tight text-center'>{headline}</h1>
        <p className='text-lg text-gray-700 mb-8'>{description}</p>
        <div className='flex flex-col sm:flex-row items-center justify-center gap-4 mb-8'>
          {secondaryCtaText && (
            <a href={secondaryCtaLink} className='w-full sm:w-auto px-6 py-3 border border-gray-300 rounded-full text-gray-800 font-semibold hover:bg-gray-50 text-sm'>
              {secondaryCtaText}
            </a>
          )}
          {primaryCtaText && (
            <a href={primaryCtaLink} className='w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 text-sm'>
              {primaryCtaText}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

const renderIcon = (iconType?: string) => {
  if (iconType === 'user') return <svg className='w-3 h-3 mr-1 text-gray-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' /></svg>
  if (iconType === 'calendar') return <svg className='w-3 h-3 mr-1 text-gray-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' /></svg>
  if (iconType === 'check-circle') return <svg className='w-3 h-3 mr-1 text-green-500' fill='currentColor' viewBox='0 0 20 20'><path fillRule='evenodd' d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z' clipRule='evenodd' /></svg>
  if (iconType === 'plus') return <svg className='w-3 h-3 mr-1 text-gray-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M12 6v6m0 0v6m0-6h6m-6 0H6' /></svg>
  if (iconType === 'upload') return <svg className='w-3 h-3 mr-1' fill='none' stroke='white' viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' /></svg>
  if (iconType === 'document') return <svg className='w-3 h-3 mr-1 text-gray-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' /></svg>
  if (iconType === 'info') return <svg className='w-3 h-3 mr-1 text-gray-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' /></svg>
  if (iconType === 'folder') return <svg className='w-3 h-3 mr-1 text-gray-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' /></svg>
  return null
}

const AppPreviewHeaderControls: React.FC<AppPreviewHeaderControlsData> = ({ filters, actions }) => {
  return (
    <div className='flex flex-col md:flex-row items-start md:items-center justify-between text-gray-500 text-xs space-y-2 md:space-y-0 w-full' dir='rtl'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='hidden md:inline-block text-gray-600'>סנן לפי:</span>
        {filters.map((filter, index) => (
          <button key={index} className='flex items-center px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-100'>
            {renderIcon(filter.icon)}
            <span className='text-gray-600'>{filter.label}</span>
            {filter.dropdown && (
              <svg className='w-3 h-3 ml-1 text-gray-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M19 9l-7 7-7-7' />
              </svg>
            )}
          </button>
        ))}
      </div>
      <div className='flex items-center gap-2 mt-2 md:mt-0'>
        {actions.map((action, index) => (
          <button
            key={index}
            className={`flex items-center px-2 py-1 rounded text-xs font-semibold ${action.type === 'button-primary' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
          >
            {renderIcon(action.icon)}
            {action.text}
          </button>
        ))}
      </div>
    </div>
  )
}

const AppDataTable: React.FC<AppDataTableData> = ({ headers, data }) => {
  const colorMap: Record<string, { dot: string; badge: string; text: string }> = {
    green: { dot: 'bg-green-500', badge: 'bg-green-100', text: 'text-green-800' },
    blue: { dot: 'bg-blue-500', badge: 'bg-blue-100', text: 'text-blue-800' },
    yellow: { dot: 'bg-yellow-500', badge: 'bg-yellow-100', text: 'text-yellow-800' },
    gray: { dot: 'bg-gray-400', badge: 'bg-gray-100', text: 'text-gray-700' },
    red: { dot: 'bg-red-500', badge: 'bg-red-100', text: 'text-red-800' },
  }

  return (
    <div className='bg-white rounded-md shadow-inner overflow-hidden border border-gray-200' dir='rtl'>
      <div className='grid grid-cols-[1.8fr_1.2fr_0.8fr_1fr_1fr_1.2fr] gap-4 text-xs text-gray-500 px-4 py-2 border-b border-gray-200 bg-gray-100'>
        {headers.map((header) => (
          <div key={header.id} className='flex items-center'>
            {renderIcon(header.icon)}
            {header.label}
          </div>
        ))}
      </div>

      {data.map((row, index) => {
        const colors = colorMap[row.statusColor] ?? colorMap.gray
        return (
          <div
            key={row.id ?? index}
            className={`grid grid-cols-[1.8fr_1.2fr_0.8fr_1fr_1fr_1.2fr] gap-4 text-sm text-gray-700 px-4 py-2 items-center cursor-pointer hover:bg-gray-50 ${index < data.length - 1 ? 'border-b border-gray-200' : ''}`}
          >
            <div className='flex items-center font-medium'>
              <span className={`inline-block w-2.5 h-2.5 ${colors.dot} rounded-full mr-2`} />
              {row.name}
            </div>
            <div>{row.assignee.join(', ')}</div>
            <div>
              <span className={`inline-block px-2 py-0.5 ${colors.badge} ${colors.text} rounded-full text-xs font-medium`}>
                {row.status}
              </span>
            </div>
            <div className='text-gray-700'>{row.dueDate}</div>
            <div className='text-gray-700 truncate'>{row.project}</div>
            <div className='text-gray-500 text-xs'>{row.phone}</div>
          </div>
        )
      })}
    </div>
  )
}

const AppPreviewSection: React.FC<AppPreviewData> = ({ headerControls, appDataTable }) => {
  return (
    <div className='relative z-20 px-8 lg:px-12 pb-8 bg-gray-50 rounded-b-xl'>
      <div className='flex flex-col md:flex-row items-start md:items-center justify-end text-gray-500 text-xs space-y-4 md:space-y-0 pt-4 mb-4'>
        <AppPreviewHeaderControls filters={headerControls.filters} actions={headerControls.actions} />
      </div>
      <AppDataTable headers={appDataTable.headers} data={appDataTable.data} />
    </div>
  )
}

interface HeroSectionProps {
  data: HeroSectionComponentData
}

export const HeroSection: React.FC<HeroSectionProps> = ({ data }) => {
  const { heroContent, appPreview } = data

  return (
    <div className='relative bg-blue-50 overflow-hidden font-sans pb-8 px-4'>
      <AbstractBackground />

      <MarketingNavbar />

      <div className='relative z-10 max-w-6xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden'>
        <HeroContent {...heroContent} />
        <AppPreviewSection {...appPreview} />
      </div>
    </div>
  )
}

export default HeroSection
