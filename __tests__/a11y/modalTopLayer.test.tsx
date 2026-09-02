// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import ModalPop from '@/lib/modals/ModalPop'

/**
 * A dialog opened from inside a native `popover='auto'` form used to be
 * unreachable. The portal put it at <body> with z-99999, but the form was in
 * the browser's top layer, which paints above every ordinary stacking context
 * no matter how high the z-index climbs — so the error dialog on the invitation
 * form and the one on the user editor were painted behind the form that raised
 * them. Raising the z-index cannot fix that; joining the layer can.
 *
 * These assertions are therefore about the mechanism — the attribute and the
 * show/hide calls — and about the engine that has no top layer at all, where
 * the attribute must not appear, because the UA sheet would hide the dialog
 * outright while giving nothing back.
 */
const proto = HTMLElement.prototype as unknown as Record<string, unknown>
const hadNative = 'showPopover' in proto

function stubTopLayerSupport() {
  const show = vi.fn()
  const hide = vi.fn()
  proto.showPopover = show
  proto.hidePopover = hide
  return { show, hide }
}

afterEach(() => {
  cleanup()
  if (!hadNative) {
    delete proto.showPopover
    delete proto.hidePopover
  }
})

describe('where the browser has a top layer', () => {
  beforeEach(() => cleanup())

  it('marks the scrim as a popover so it cannot be painted beneath one', async () => {
    stubTopLayerSupport()
    render(
      <ModalPop open onClose={() => {}} label='דו-שיח'>
        <p>תוכן</p>
      </ModalPop>,
    )
    await waitFor(() => expect(document.querySelector('[popover]')).toBeTruthy())
    expect(document.querySelector('[popover]')?.getAttribute('popover')).toBe('manual')
  })

  it("is 'manual', which cannot force the form underneath it closed", async () => {
    stubTopLayerSupport()
    render(
      <ModalPop open onClose={() => {}} label='דו-שיח'>
        <p>תוכן</p>
      </ModalPop>,
    )
    // 'auto' light-dismisses AND closes every other auto popover — it would
    // tear down the invite form the dialog was opened from.
    await waitFor(() => expect(document.querySelector('[popover]')).toBeTruthy())
    expect(document.querySelector("[popover='auto']")).toBeNull()
  })

  it('shows the popover on open and releases the layer on close', async () => {
    const { show, hide } = stubTopLayerSupport()
    const view = render(
      <ModalPop open onClose={() => {}} label='דו-שיח'>
        <p>תוכן</p>
      </ModalPop>,
    )
    await waitFor(() => expect(show).toHaveBeenCalled())
    view.rerender(
      <ModalPop open={false} onClose={() => {}} label='דו-שיח'>
        <p>תוכן</p>
      </ModalPop>,
    )
    await waitFor(() => expect(hide).toHaveBeenCalled())
  })

  it('a throwing showPopover never takes the dialog down with it', async () => {
    proto.showPopover = () => {
      throw new Error('InvalidStateError')
    }
    proto.hidePopover = vi.fn()
    render(
      <ModalPop open onClose={() => {}} label='דו-שיח'>
        <p>עדיין כאן</p>
      </ModalPop>,
    )
    expect(await screen.findByText('עדיין כאן')).toBeTruthy()
  })
})

describe('where the browser has no top layer', () => {
  beforeEach(() => {
    cleanup()
    delete proto.showPopover
    delete proto.hidePopover
  })

  it('leaves the attribute off entirely, so the UA sheet cannot hide the dialog', async () => {
    render(
      <ModalPop open onClose={() => {}} label='דו-שיח'>
        <p>תוכן</p>
      </ModalPop>,
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(document.querySelector('[popover]')).toBeNull()
  })

  it('keeps the dialog reachable by role, exactly as before the change', async () => {
    render(
      <ModalPop open onClose={() => {}} label='הודעת שגיאה'>
        <p>תוכן</p>
      </ModalPop>,
    )
    expect(await screen.findByRole('dialog', { name: 'הודעת שגיאה' })).toBeTruthy()
  })
})
