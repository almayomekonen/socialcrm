/**
 * jsdom gaps the marketing tree touches.
 *
 * These are browser APIs jsdom does not implement, not application behaviour.
 * The marketing components degrade correctly when they are genuinely absent
 * (see `components/seo/sections/FadeIn.tsx`), but the render must get far
 * enough to be asserted on, so they are stubbed rather than left missing.
 *
 * Deliberately inert: observers never fire, `matchMedia` always reports "no
 * preference", canvas contexts are no-ops. Nothing here can make a test pass
 * that would fail in a real browser — it only stops the render from throwing.
 */

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  }

  if (!('ResizeObserver' in window)) {
    ;(window as unknown as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }

  // SVG geometry: jsdom parses SVG but implements no layout, so path metrics
  // used by draw-on animations are absent.
  const proto = (window as unknown as { SVGElement?: { prototype: Record<string, unknown> } }).SVGElement?.prototype
  if (proto && typeof proto.getTotalLength !== 'function') {
    proto.getTotalLength = () => 0
    proto.getPointAtLength = () => ({ x: 0, y: 0 })
  }

  // Canvas: jsdom throws "not implemented" without the optional `canvas` package.
  const canvasProto = (window as unknown as { HTMLCanvasElement?: { prototype: Record<string, unknown> } })
    .HTMLCanvasElement?.prototype
  if (canvasProto) {
    canvasProto.getContext = () => null
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    constructor(_cb: unknown, _opts?: unknown) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: number[] = []
  }
}

export {}
