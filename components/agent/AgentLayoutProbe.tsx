'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * TEMPORARY — real-device layout probe for /agent on iPhone.
 *
 * Emulation (WebKit and Chromium, touch, real Safari heights) cannot reproduce
 * what a real iPhone shows, and there is no simulator on hand. This reports what
 * the device actually computed, so the next fix is measured, not guessed.
 *
 * Rendered only for `?agentdebug=1` AND a platform owner (see the page). It reads
 * geometry, computed styles, media-query matches, stylesheet paths and the build
 * SHA — never page text, names, leads or anything a customer typed.
 *
 * Remove once the mobile layout is verified on the failing device.
 */

type Rect = { t: number; b: number; l: number; r: number; w: number; h: number }
const round = (n: number) => Math.round(n * 10) / 10

function box(el: Element | null) {
  if (!el) return null
  const b = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  const parent = (el as HTMLElement).offsetParent
  const rect: Rect = { t: round(b.top), b: round(b.bottom), l: round(b.left), r: round(b.right), w: round(b.width), h: round(b.height) }
  return {
    rect,
    position: s.position,
    display: s.display,
    height: s.height,
    minHeight: s.minHeight,
    overflowY: s.overflowY,
    flex: s.flex,
    paddingBottom: s.paddingBottom,
    containingBlock: parent ? parent.tagName.toLowerCase() + (parent.id ? `#${parent.id}` : '') + [...parent.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}]`).join('') : null,
    scroll: el.scrollHeight > el.clientHeight + 1 ? { client: el.clientHeight, content: el.scrollHeight, top: round(el.scrollTop) } : null,
  }
}

function safeArea() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const s = getComputedStyle(probe)
  const out = { top: s.paddingTop, right: s.paddingRight, bottom: s.paddingBottom, left: s.paddingLeft }
  probe.remove()
  return out
}

export function measureAgentLayout(build: string) {
  const vv = window.visualViewport
  const root = document.documentElement
  const card = document.querySelector('textarea[aria-label="שאל את הסוכן"]')?.parentElement ?? null
  const action = card ? [...card.querySelectorAll('button')].find((b) => /שליחה|הקלטה קולית|עצירת ההקלטה|ממתין/.test(b.getAttribute('aria-label') ?? '') && b.parentElement === card) ?? null : null
  const shell = document.querySelector('[data-mobile-workspace]')
  const mq = (q: string) => matchMedia(q).matches
  return {
    build,
    at: new Date().toISOString(),
    ua: navigator.userAgent,
    viewport: {
      innerW: innerWidth, innerH: innerHeight,
      clientH: root.clientHeight, screenH: screen.height, dpr: devicePixelRatio,
      vvH: vv ? round(vv.height) : null, vvW: vv ? round(vv.width) : null, vvTop: vv ? round(vv.offsetTop) : null, vvScale: vv ? vv.scale : null,
      publishedH: root.style.getPropertyValue('--mobile-visible-h') || null,
      publishedTop: root.style.getPropertyValue('--mobile-visible-top') || null,
      docScrolls: (document.scrollingElement?.scrollHeight ?? 0) > innerHeight + 1,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
      safeArea: safeArea(),
    },
    media: {
      pointerCoarse: mq('(pointer: coarse)'), hoverNone: mq('(hover: none)'),
      standalone: mq('(display-mode: standalone)'), reducedMotion: mq('(prefers-reduced-motion: reduce)'),
      supportsHas: CSS.supports('selector(:has(*))'), supportsLayer: typeof CSSLayerBlockRule !== 'undefined',
    },
    stylesheets: [...document.styleSheets].map((s) => (s.href ? new URL(s.href).pathname : 'inline')),
    elements: {
      column: box(shell?.parentElement ?? null),
      shell: box(shell),
      header: box(document.querySelector('[data-mobile-header]')),
      main: box(document.getElementById('main-content')),
      agentRoot: box(document.querySelector('[data-mobile-scroll-owner]') ?? document.getElementById('main-content')?.firstElementChild ?? null),
      content: box(document.querySelector('[data-agent-scroll]')),
      composer: box(document.querySelector('[data-agent-composer]')),
      card: box(card),
      textarea: box(card?.querySelector('textarea') ?? null),
      action: box(action),
      tabBar: box(shell ? shell.querySelector(':scope > nav') : null),
    },
  }
}

export default function AgentLayoutProbe({ build }: { build: string }) {
  const [report, setReport] = useState('')
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => setReport(JSON.stringify(measureAgentLayout(build), null, 1)), [build])

  useEffect(() => {
    const t = setTimeout(refresh, 400)
    const vv = window.visualViewport
    vv?.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    return () => { clearTimeout(t); vv?.removeEventListener('resize', refresh); window.removeEventListener('orientationchange', refresh) }
  }, [refresh])

  async function copy() {
    refresh()
    try { await navigator.clipboard.writeText(JSON.stringify(measureAgentLayout(build), null, 1)); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <div dir='ltr' data-agent-layout-probe className='fixed inset-x-2 top-2 z-[10000] rounded-md border border-red-600 bg-white/95 p-2 font-mono text-[10px] leading-tight text-ink shadow-lg'>
      <div className='flex gap-2'>
        <button type='button' onClick={copy} className='rounded border px-2 py-1 font-sans text-xs font-semibold'>{copied ? 'הועתק' : 'העתקת המדידות'}</button>
        <button type='button' onClick={refresh} className='rounded border px-2 py-1 font-sans text-xs'>מדידה מחדש</button>
        <button type='button' onClick={() => setOpen((o) => !o)} className='ms-auto rounded border px-2 py-1 font-sans text-xs'>{open ? 'הסתרה' : 'הצגה'}</button>
      </div>
      {open && <pre className='mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap break-all'>{report}</pre>}
    </div>
  )
}
