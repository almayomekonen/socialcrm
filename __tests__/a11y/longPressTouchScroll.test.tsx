// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import useLongPress, { LONG_PRESS_MS } from '@/components/mobile/useLongPress'

/**
 * THE STUCK-SCROLL REGRESSION.
 *
 * `useLongPress` used to call `setPointerCapture()` on every `pointerdown`,
 * touch included. iOS Safari reads that as the page claiming the gesture, so the
 * native pan of the enclosing scroller never starts: a finger landing on a
 * message bubble — most of the surface of a long WhatsApp thread — could not
 * scroll the conversation, while a finger landing on wallpaper could.
 *
 * The existing viewport specs could not catch this. They scroll by assigning
 * `list.scrollTop = …`, which proves the element IS a scroll container but never
 * exercises gesture delivery, so the defect stayed green through four fix rounds.
 * These assertions are about the INPUT path, not geometry, which is why they are
 * here and not in the geometry spec.
 */

const capture = vi.fn()
const release = vi.fn()

beforeEach(() => {
  // jsdom implements neither; the hook guards both in try/catch.
  ;(Element.prototype as unknown as { setPointerCapture: unknown }).setPointerCapture = capture
  ;(Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = release
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

function Host({ onLongPress }: { onLongPress: () => void }) {
  const handlers = useLongPress(onLongPress)
  return (
    <div data-testid='host' {...handlers}>
      הודעה
    </div>
  )
}

describe('long press never blocks native touch scrolling', () => {
  it('does NOT capture a touch pointer — iOS needs the gesture to pan the thread', () => {
    render(<Host onLongPress={() => {}} />)
    fireEvent.pointerDown(screen.getByTestId('host'), {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 20,
      clientY: 20,
    })
    expect(capture).not.toHaveBeenCalled()
  })

  it('still captures mouse and pen, where the gesture is a drag and nothing pans', () => {
    render(<Host onLongPress={() => {}} />)
    const host = screen.getByTestId('host')
    fireEvent.pointerDown(host, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 })
    expect(capture).toHaveBeenCalledWith(2)

    capture.mockClear()
    fireEvent.pointerDown(host, { pointerId: 3, pointerType: 'pen', button: 0, clientX: 5, clientY: 5 })
    expect(capture).toHaveBeenCalledWith(3)
  })

  it('still fires the long press on touch after the hold', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    render(<Host onLongPress={onLongPress} />)
    fireEvent.pointerDown(screen.getByTestId('host'), {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 20,
      clientY: 20,
    })
    vi.advanceTimersByTime(LONG_PRESS_MS + 20)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('still cancels the long press when the finger travels — a scroll must not open the sheet', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    render(<Host onLongPress={onLongPress} />)
    const host = screen.getByTestId('host')
    fireEvent.pointerDown(host, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(host, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 90 })
    vi.advanceTimersByTime(LONG_PRESS_MS + 20)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('still cancels when iOS hands the gesture to the scroller via pointercancel', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    render(<Host onLongPress={onLongPress} />)
    const host = screen.getByTestId('host')
    fireEvent.pointerDown(host, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerCancel(host, { pointerId: 1, pointerType: 'touch' })
    vi.advanceTimersByTime(LONG_PRESS_MS + 20)
    expect(onLongPress).not.toHaveBeenCalled()
  })
})
