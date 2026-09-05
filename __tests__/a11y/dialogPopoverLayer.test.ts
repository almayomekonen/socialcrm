import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A POPOVER OPENED FROM A DIALOG MUST JOIN THE DIALOG'S LAYER.
 *
 * `ModalPop` promotes its scrim into the browser's TOP LAYER, which paints
 * above every ordinary stacking context no matter how high a z-index climbs.
 * A panel portalled to <body> is in the ordinary layer, so a picker or menu
 * opened from inside a dialog is painted BEHIND the dialog that opened it —
 * exactly what happened on /calendar to the meeting form's lead picker.
 *
 * Raising the z-index cannot fix that, which is what makes this worth guarding:
 * the next person to hit the symptom will reach for a bigger number, and it
 * will not work. The fix is `lib/useTopLayer.ts`, and these are the components
 * that portal a panel to <body> AND are rendered inside a ModalPop today.
 */
const read = (p: string) => readFileSync(p, 'utf8')

const IN_DIALOG_POPOVERS: Array<[component: string, dialog: string]> = [
  // The meeting form's "בחר לקוח/ה" picker; also the billing invoice editor.
  ['components/billing/lead-picker/LeadPickerPanel.tsx', 'components/calendar/MeetingFormDialog.tsx'],
  // The follow-up menu inside the meeting details dialog.
  ['components/leads/FollowUpControl.tsx', 'components/calendar/MeetingDetailsDialog.tsx'],
]

describe('popovers rendered inside a dialog', () => {
  it('ModalPop still promotes its scrim, which is what makes this necessary', () => {
    const src = read('lib/modals/ModalPop.tsx')
    expect(src).toMatch(/showPopover\(\)/)
    expect(src).toMatch(/popover=\{canTopLayer \? 'manual' : undefined\}/)
  })

  it.each(IN_DIALOG_POPOVERS)('%s joins the top layer', (component) => {
    const src = read(component)
    expect(src, 'portals to <body>, so it is in the ordinary layer').toContain('document.body')
    expect(src, 'must be promoted, not merely given a bigger z-index').toContain('useTopLayerPromotion')
    expect(src).toMatch(/popover=\{canTopLayer \? 'manual' : undefined\}/)
    // 'auto' light-dismisses and closes every other auto popover — it would
    // tear down the dialog the panel was opened from.
    expect(src).not.toMatch(/popover='auto'/)
    // `inset: 0` from the UA sheet would stretch the panel across the viewport.
    expect(src).toContain("inset: 'auto'")
  })

  it.each(IN_DIALOG_POPOVERS)('%s is still rendered by %s', (component, dialog) => {
    // If this ever fails the pairing above is stale: either the component moved
    // out of the dialog (drop the row) or the dialog stopped using it.
    const name = component.split('/').pop()!.replace('.tsx', '').replace('Panel', '')
    expect(read(dialog)).toContain(name)
  })
})
