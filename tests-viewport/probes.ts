/**
 * In-page measurement probes for the A2a run.
 *
 * Every function here is serialized and executed INSIDE the browser by
 * `page.evaluate`, so each one must be entirely self-contained: no imports, no
 * closures over module scope, no TypeScript-only runtime helpers. They take
 * plain arguments and return plain JSON.
 *
 * These MEASURE. They do not assert. A2a's whole purpose is to produce numbers
 * to decide from, so a probe that returned pass/fail would be throwing away the
 * result before anyone had read it.
 */

export type OverflowFinding = {
  selector: string
  name: string
  rect: { left: number; right: number; width: number }
  overflowBy: number
  side: 'left' | 'right'
  scrollableAncestor: boolean
}

export type OverflowResult = {
  documentScrollWidth: number
  documentClientWidth: number
  documentOverflow: number
  bodyOverflowX: string
  masked: boolean
  elements: OverflowFinding[]
  scrollableRegions: { selector: string; scrollWidth: number; clientWidth: number; overflowBy: number }[]
}

export type TargetFinding = {
  selector: string
  name: string
  role: string
  visual: { w: number; h: number }
  hit: { w: number; h: number }
  hasTap44: boolean
  hasPress: boolean
  minSide: number
}

export type InputFinding = {
  selector: string
  name: string
  type: string
  fontSize: number
  zoomRisk: boolean
}

export type StickyFinding = {
  selector: string
  name: string
  position: string
  rect: { top: number; bottom: number; left: number; right: number; height: number }
  zIndex: string
  paddingBottom: string
  usesSafeArea: boolean
}

/* ------------------------------------------------------------------ */

/**
 * Horizontal overflow.
 *
 * `document.scrollWidth <= clientWidth` ALONE IS NOT A VALID TEST HERE.
 * `lib/css/main.css` sets `body { overflow-x: hidden }`, which clips horizontal
 * overflow instead of removing it — the document measurement therefore passes
 * even while content is genuinely unreachable off the edge. So the real signal
 * is per-element: any visible element whose box extends past a viewport edge.
 *
 * RTL-aware: the app is `dir=rtl`, so overflow escapes to the LEFT at least as
 * often as to the right. Both edges are checked.
 *
 * Elements inside a legitimately scrollable ancestor (`overflow-x: auto|scroll`)
 * are recorded but flagged, because a horizontally scrollable strip is a design
 * decision, not a layout bug.
 */
export function probeOverflow(tolerance: number): OverflowResult {
  const de = document.documentElement
  const vw = de.clientWidth

  const cssPath = (el: Element): string => {
    const parts: string[] = []
    let cur: Element | null = el
    let depth = 0
    while (cur && depth < 4) {
      let s = cur.tagName.toLowerCase()
      if (cur.id) {
        s += '#' + cur.id
        parts.unshift(s)
        break
      }
      const cls = (cur.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3)
      if (cls.length) s += '.' + cls.join('.')
      parts.unshift(s)
      cur = cur.parentElement
      depth++
    }
    return parts.join(' > ')
  }

  const nameOf = (el: Element): string =>
    (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('alt') || '')
      .trim()
      .slice(0, 60)
      .replace(/\s+/g, ' ')

  const isHidden = (el: Element): boolean => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true
    // sr-only / visually-hidden clipping patterns are intentionally offscreen.
    if (cs.position === 'absolute' && cs.clip !== 'auto' && cs.clip !== '') return true
    if (cs.clipPath && cs.clipPath.includes('inset(50%)')) return true
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return true
    return false
  }

  const hasScrollableAncestor = (el: Element): boolean => {
    let cur: Element | null = el.parentElement
    while (cur && cur !== document.body) {
      const ox = getComputedStyle(cur).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
      cur = cur.parentElement
    }
    return false
  }

  const elements: OverflowFinding[] = []
  const scrollableRegions: OverflowResult['scrollableRegions'] = []

  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'HEAD') continue
    if (isHidden(el)) continue

    const cs = getComputedStyle(el)
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
      const over = el.scrollWidth - el.clientWidth
      if (over > tolerance) {
        scrollableRegions.push({
          selector: cssPath(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowBy: Math.round(over),
        })
      }
    }

    // A fixed-position element pinned off-canvas (drawers) is not overflow.
    if (cs.position === 'fixed' && (cs.transform || '').includes('matrix')) continue

    const r = el.getBoundingClientRect()
    const overRight = r.right - vw
    const overLeft = -r.left

    if (overRight > tolerance || overLeft > tolerance) {
      const side: 'left' | 'right' = overRight >= overLeft ? 'right' : 'left'
      elements.push({
        selector: cssPath(el),
        name: nameOf(el),
        rect: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) },
        overflowBy: Math.round(Math.max(overRight, overLeft)),
        side,
        scrollableAncestor: hasScrollableAncestor(el),
      })
    }
  }

  elements.sort((a, b) => b.overflowBy - a.overflowBy)

  const bodyOverflowX = getComputedStyle(document.body).overflowX
  return {
    documentScrollWidth: de.scrollWidth,
    documentClientWidth: de.clientWidth,
    documentOverflow: de.scrollWidth - de.clientWidth,
    bodyOverflowX,
    masked: bodyOverflowX === 'hidden' || bodyOverflowX === 'clip',
    elements: elements.slice(0, 25),
    scrollableRegions,
  }
}

/**
 * Touch targets.
 *
 * Measures the EFFECTIVE HIT AREA, not the drawn box. `.tap-44` deliberately
 * keeps an icon visually small and extends the touchable region with an
 * `::after` pseudo-element (`width: max(100%, 44px)`), so reporting the visual
 * rect would flag compliant controls as violations. Both are returned.
 *
 * Requires touch emulation: the `.tap-44` rule lives behind
 * `@media (pointer: coarse)` and simply does not exist without it.
 */
export function probeTargets(minSize: number): TargetFinding[] {
  const SEL = [
    'a[href]',
    'button',
    'input:not([type=hidden])',
    'select',
    'textarea',
    '[role=button]',
    '[role=tab]',
    '[role=link]',
    '[role=switch]',
    '[role=checkbox]',
    '[role=menuitem]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  const cssPath = (el: Element): string => {
    const parts: string[] = []
    let cur: Element | null = el
    let depth = 0
    while (cur && depth < 3) {
      let s = cur.tagName.toLowerCase()
      if (cur.id) {
        s += '#' + cur.id
        parts.unshift(s)
        break
      }
      const cls = (cur.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3)
      if (cls.length) s += '.' + cls.join('.')
      parts.unshift(s)
      cur = cur.parentElement
      depth++
    }
    return parts.join(' > ')
  }

  const out: TargetFinding[] = []

  for (const el of Array.from(document.querySelectorAll(SEL))) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // Skip-links and other visually-hidden affordances.
    if (cs.clipPath && cs.clipPath.includes('inset(50%)')) continue
    if (r.bottom < 0 || r.top > (window.innerHeight || 0) * 4) continue

    const cls = el.getAttribute('class') || ''
    const hasTap44 = cls.split(/\s+/).includes('tap-44')
    const hasPress = cls.split(/\s+/).includes('press')

    let hitW = r.width
    let hitH = r.height
    if (hasTap44) {
      const after = getComputedStyle(el, '::after')
      const aw = parseFloat(after.width)
      const ah = parseFloat(after.height)
      if (!Number.isNaN(aw)) hitW = Math.max(hitW, aw)
      if (!Number.isNaN(ah)) hitH = Math.max(hitH, ah)
    }

    const minSide = Math.min(hitW, hitH)
    if (minSide + 0.5 < minSize) {
      out.push({
        selector: cssPath(el),
        name: (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').trim().slice(0, 50).replace(/\s+/g, ' '),
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        visual: { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 },
        hit: { w: Math.round(hitW * 10) / 10, h: Math.round(hitH * 10) / 10 },
        hasTap44,
        hasPress,
        minSide: Math.round(minSide * 10) / 10,
      })
    }
  }

  return out
}

/**
 * iOS input zoom risk.
 *
 * Safari zooms the page when a focused text input renders below 16px. Checkbox,
 * radio, button-like and hidden inputs never trigger it and are excluded, so the
 * list is only controls a rep actually types into.
 */
export function probeInputs(): InputFinding[] {
  const NON_TEXT = ['checkbox', 'radio', 'hidden', 'submit', 'button', 'reset', 'range', 'color', 'file', 'image']
  const out: InputFinding[] = []

  for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase()
    if (NON_TEXT.includes(type)) continue

    const fontSize = parseFloat(cs.fontSize)
    out.push({
      selector:
        el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : '') +
        '.' + (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.'),
      name: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.id || '').slice(0, 50),
      type,
      fontSize,
      zoomRisk: fontSize < 16,
    })
  }

  return out
}

/** Fixed / sticky chrome: geometry, stacking, and whether it consumes a safe-area inset. */
export function probeSticky(): StickyFinding[] {
  const out: StickyFinding[] = []

  for (const el of Array.from(document.querySelectorAll('*'))) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue

    const styleAttr = el.getAttribute('style') || ''
    const cls = el.getAttribute('class') || ''
    const usesSafeArea = /safe-area-inset/.test(styleAttr) || /safe-area-inset/.test(cls)

    out.push({
      selector:
        el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : '') +
        '.' + cls.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.'),
      name: (el.getAttribute('aria-label') || '').slice(0, 40),
      position: cs.position,
      rect: {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        height: Math.round(r.height),
      },
      zIndex: cs.zIndex,
      paddingBottom: cs.paddingBottom,
      usesSafeArea,
    })
  }

  return out
}

/**
 * Which elements consume `env(safe-area-inset-*)`, and whether any inset is
 * applied twice down a single ancestor chain (the classic double-count that
 * leaves a fat dead band above the home indicator).
 *
 * NOTE FOR THE REPORT: desktop Chromium reports all insets as 0px, so this
 * detects DECLARATIONS and STRUCTURE. It cannot prove on-device rendering.
 */
export function probeSafeArea(): {
  consumers: { selector: string; declaration: string; computedPaddingBottom: string; computedPaddingTop: string }[]
  nestedPairs: { ancestor: string; descendant: string }[]
} {
  const consumers: { selector: string; declaration: string; computedPaddingBottom: string; computedPaddingTop: string }[] = []
  const nodes: Element[] = []

  const sel = (el: Element) =>
    el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : '') +
    '.' + (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.')

  for (const el of Array.from(document.querySelectorAll('*'))) {
    const styleAttr = el.getAttribute('style') || ''
    const cls = el.getAttribute('class') || ''
    const decl: string[] = []
    if (/safe-area-inset/.test(styleAttr)) decl.push('style="' + styleAttr.slice(0, 120) + '"')
    const m = cls.match(/[^\s]*safe-area-inset[^\s]*/g)
    if (m) decl.push('class=' + m.join(' '))
    if (!decl.length) continue

    const cs = getComputedStyle(el)
    consumers.push({
      selector: sel(el),
      declaration: decl.join(' | '),
      computedPaddingBottom: cs.paddingBottom,
      computedPaddingTop: cs.paddingTop,
    })
    nodes.push(el)
  }

  const nestedPairs: { ancestor: string; descendant: string }[] = []
  for (const a of nodes) {
    for (const b of nodes) {
      if (a !== b && a.contains(b)) nestedPairs.push({ ancestor: sel(a), descendant: sel(b) })
    }
  }

  return { consumers, nestedPairs }
}

/**
 * Is the bottom of the scrollable content reachable, or does the fixed chrome
 * sit on top of it after scrolling to the end?
 */
export function probeBottomReachability(): {
  scroller: string | null
  scrollHeight: number
  clientHeight: number
  scrolledToEnd: boolean
  lastChildBottom: number | null
  tabBarTop: number | null
  coveredBy: number | null
} {
  const main = document.querySelector('main#main-content') as HTMLElement | null
  const nav = document.querySelector('nav[aria-label="ניווט ראשי"]') as HTMLElement | null

  if (!main) {
    return {
      scroller: null,
      scrollHeight: 0,
      clientHeight: 0,
      scrolledToEnd: false,
      lastChildBottom: null,
      tabBarTop: null,
      coveredBy: null,
    }
  }

  main.scrollTop = main.scrollHeight
  const scrolledToEnd = Math.abs(main.scrollTop + main.clientHeight - main.scrollHeight) < 2

  let last: Element | null = null
  const kids = main.querySelectorAll('*')
  let maxBottom = -Infinity
  for (const k of Array.from(kids)) {
    const cs = getComputedStyle(k)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue
    const r = k.getBoundingClientRect()
    if (r.height === 0) continue
    if (r.bottom > maxBottom) {
      maxBottom = r.bottom
      last = k
    }
  }

  const tabTop = nav ? nav.getBoundingClientRect().top : null
  const covered = tabTop != null && maxBottom > tabTop ? Math.round(maxBottom - tabTop) : null

  return {
    scroller: 'main#main-content',
    scrollHeight: main.scrollHeight,
    clientHeight: main.clientHeight,
    scrolledToEnd,
    lastChildBottom: Number.isFinite(maxBottom) ? Math.round(maxBottom) : null,
    tabBarTop: tabTop == null ? null : Math.round(tabTop),
    coveredBy: covered,
  }
}

/** Inventory of state affordances present in the DOM right now. */
export function probeStates(): {
  skeletons: number
  liveRegions: number
  statusRoles: number
  alertRoles: number
  headings: string[]
  emptyStateText: string | null
} {
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ')
  const emptyMarkers = [
    'אין לידים',
    'לא נמצאו לידים',
    'עוד אין לידים',
    'אין התראות',
    'אין שיחות',
    'אין עכשיו מה לעשות',
  ]
  const found = emptyMarkers.find((m) => txt.includes(m)) || null

  return {
    skeletons: document.querySelectorAll('[class*="animate-pulse"], [data-skeleton], [aria-busy="true"]').length,
    liveRegions: document.querySelectorAll('[aria-live]').length,
    statusRoles: document.querySelectorAll('[role="status"]').length,
    alertRoles: document.querySelectorAll('[role="alert"]').length,
    headings: Array.from(document.querySelectorAll('h1,h2'))
      .map((h) => (h as HTMLElement).innerText.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 8),
    emptyStateText: found,
  }
}
