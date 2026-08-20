/**
 * Shared marketing section pieces. SERVER COMPONENT — deliberately.
 *
 * This file used to carry `'use client'` for one reason: `FadeIn` was a
 * `motion.div`. Six sections import from here, so that single directive made
 * most of the marketing page client-rendered. `FadeIn` now lives in its own
 * client file and is re-exported, which keeps every call site unchanged while
 * letting this module — and the sections that import it — render on the server.
 */

export { FadeIn } from './FadeIn'

export function SectionHeader({ badge, title, subtitle }: { badge?: string; title: string; subtitle?: string }) {
  return (
    <div className='text-center mb-16'>
      {badge && (
        <span className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 text-white' style={{ backgroundColor: '#3f20f5' }}>
          {badge}
        </span>
      )}
      <h2 className='text-3xl md:text-4xl font-bold mb-4' style={{ color: '#171424' }}>{title}</h2>
      {subtitle && <p className='text-gray-500 text-lg max-w-xl mx-auto'>{subtitle}</p>}
    </div>
  )
}
