// @vitest-environment jsdom
//
// מענה אוטומטי on a phone: the kill switch, and the guarantees around it.
//
// The point of this screen is that an owner can stop a machine from messaging
// their customers without finding a computer. So the assertions here are about
// authority and blast radius, not looks: who may see it, what the switch is
// allowed to write, and that a failure is visible rather than silently assumed.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1) — the data layer is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Roles } from '@/types/roles'

const H = vi.hoisted(() => ({
  getMasterEnabled: vi.fn(),
  getChannelSettings: vi.fn(),
  setAutoResponseMasterEnabled: vi.fn(),
  updateAutoResponseSettings: vi.fn(),
}))

vi.mock('@/db/autoResponseSettings', () => ({
  getMasterEnabled: H.getMasterEnabled,
  getChannelSettings: H.getChannelSettings,
}))
vi.mock('@/actions/autoResponse/setMasterEnabled', () => ({
  setAutoResponseMasterEnabled: H.setAutoResponseMasterEnabled,
}))
vi.mock('@/actions/autoResponse/updateSettings', () => ({
  updateAutoResponseSettings: H.updateAutoResponseSettings,
}))

import AutoResponseMobile from '@/modules/settings/mobile/AutoResponseMobile'
import AutoResponseToggle from '@/modules/settings/mobile/AutoResponseToggle'
import { MORE_ITEMS, visibleMoreItems } from '@/components/mobile/moreDestinations'
import { MOBILE_READY_ROUTES, SETTINGS_MOBILE_BACKLOG } from '@/lib/mobile/desktopOnlyRoutes'

const channel = (over: Record<string, unknown> = {}) => ({
  agencyId: 7,
  channel: 'whatsapp',
  enabled: true,
  quietHours: {},
  dailyCap: 200,
  guidance: null,
  mode: 'acknowledge',
  maxTurns: 3,
  collectFields: { required: [], optional: [] },
  draft: false,
  replyMode: 'ai',
  fixedBody: null,
  delaySeconds: 0,
  ...over,
})

beforeEach(() => {
  H.getMasterEnabled.mockResolvedValue(true)
  H.getChannelSettings.mockResolvedValue(channel())
  H.setAutoResponseMasterEnabled.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile מענה אוטומטי — access', () => {
  it('renders for an admin', async () => {
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    expect(screen.getByTestId('auto-response-toggle')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'מענה אוטומטי בוואטסאפ' })).toBeTruthy()
  })

  it('renders nothing operable for a non-admin, and never reads the settings', async () => {
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.AGNT }))
    expect(screen.queryByTestId('auto-response-toggle')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('אין לך הרשאה לצפות בדף זה')).toBeTruthy()
    // The gate runs BEFORE the reads — a non-admin costs no query.
    expect(H.getMasterEnabled).not.toHaveBeenCalled()
    expect(H.getChannelSettings).not.toHaveBeenCalled()
  })

  it('is admin-only in the mobile עוד hub', () => {
    const item = MORE_ITEMS.find((i) => i.href === '/settings/auto-response')
    expect(item?.adminOnly).toBe(true)

    const asAgent = visibleMoreItems({ role: 'AGNT', inspectorEnabled: false })
    expect(asAgent.some((i) => i.href === '/settings/auto-response')).toBe(false)

    const asAdmin = visibleMoreItems({ role: 'ADMIN', inspectorEnabled: false })
    expect(asAdmin.some((i) => i.href === '/settings/auto-response')).toBe(true)
  })
})

describe('mobile מענה אוטומטי — status', () => {
  it('says it is running when the master switch is on', async () => {
    H.getMasterEnabled.mockResolvedValue(true)
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    expect(screen.getByText('פעיל · עונה אוטומטית בוואטסאפ')).toBeTruthy()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('says it is off when the master switch is off', async () => {
    H.getMasterEnabled.mockResolvedValue(false)
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    expect(screen.getByText('כבוי · אין מענה אוטומטי')).toBeTruthy()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  /**
   * Master on + channel off sends nothing. Reporting "פעיל" alone would be a
   * false statement about the business (care-charter Laws 1-3), so the gap is
   * named on screen.
   */
  it('does not claim to be running when the WhatsApp channel is off', async () => {
    H.getMasterEnabled.mockResolvedValue(true)
    H.getChannelSettings.mockResolvedValue(channel({ enabled: false }))
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    expect(screen.getByText(/ערוץ הוואטסאפ כבוי/)).toBeTruthy()
  })
})

describe('mobile מענה אוטומטי — the configured message is read-only', () => {
  it('shows a fixed message verbatim, with no way to edit it', async () => {
    H.getChannelSettings.mockResolvedValue(
      channel({ replyMode: 'fixed', fixedBody: 'שלום, קיבלנו את הפנייה ונחזור אליך.' }),
    )
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    expect(screen.getByText('שלום, קיבלנו את הפנייה ונחזור אליך.')).toBeTruthy()
    // The ONLY control on this screen is the master switch.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })

  it('shows the stored guidance for smart replies without inventing a preview', async () => {
    H.getChannelSettings.mockResolvedValue(channel({ replyMode: 'ai', guidance: 'סטודיו לעיצוב פנים' }))
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    expect(screen.getByText('מענה חכם')).toBeTruthy()
    expect(screen.getByText('סטודיו לעיצוב פנים')).toBeTruthy()
    expect(screen.getByText(/אין נוסח קבוע להצגה/)).toBeTruthy()
  })

  it('states that advanced configuration lives on the computer', async () => {
    render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    expect(screen.getByText('הגדרות מתקדמות זמינות מהמחשב.')).toBeTruthy()
  })

  /** None of the seven desktop fields may appear on the phone. */
  it('does not expose any advanced configuration', async () => {
    H.getChannelSettings.mockResolvedValue(channel({ guidance: 'x', dailyCap: 200, delaySeconds: 30 }))
    const { container } = render(await AutoResponseMobile({ agencyId: 7, role: Roles.ADMIN }))
    const text = container.textContent ?? ''
    for (const forbidden of ['תזמון ומגבלות', 'סגנון התשובה', 'הודעה קבועה', 'שמור', 'שמירה']) {
      expect(text, `advanced config leaked: ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe('mobile מענה אוטומטי — the switch', () => {
  it('writes through the narrow action only, never the seven-field one', async () => {
    render(<AutoResponseToggle initialEnabled={true} />)
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(H.setAutoResponseMasterEnabled).toHaveBeenCalledWith(false))
    expect(H.setAutoResponseMasterEnabled).toHaveBeenCalledTimes(1)
    // The desktop action writes guidance / fixedBody / dailyCap and would
    // clobber them from a stale phone. It must never be reachable from here.
    expect(H.updateAutoResponseSettings).not.toHaveBeenCalled()
  })

  it('moves immediately, before the server answers', async () => {
    let release: (v: { ok: true }) => void = () => {}
    H.setAutoResponseMasterEnabled.mockReturnValue(new Promise((r) => (release = r)))

    render(<AutoResponseToggle initialEnabled={false} />)
    fireEvent.click(screen.getByRole('checkbox'))

    expect(screen.getByText('פעיל · עונה אוטומטית בוואטסאפ')).toBeTruthy()
    release({ ok: true })
    await waitFor(() => expect(H.setAutoResponseMasterEnabled).toHaveBeenCalled())
  })

  it('rolls back and explains when the write fails', async () => {
    H.setAutoResponseMasterEnabled.mockResolvedValue({ ok: false, reason: 'failed' })
    render(<AutoResponseToggle initialEnabled={true} />)

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('פעיל · עונה אוטומטית בוואטסאפ')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('לא הצלחנו לעדכן')
  })

  it('rolls back with a permission message when the server refuses', async () => {
    H.setAutoResponseMasterEnabled.mockResolvedValue({ ok: false, reason: 'forbidden' })
    render(<AutoResponseToggle initialEnabled={false} />)

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain('רק מנהל')
  })
})

describe('mobile מענה אוטומטי — routing and the desktop form', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'app/(app)/settings/(admin_settings)/auto-response/page.tsx'),
    'utf8',
  )

  it('branches to the phone screen before doing any desktop work', () => {
    expect(page).toContain('isMobileWorkspaceRequest')
    expect(page).toContain('<AutoResponseMobile')
    // The branch must precede the desktop reads, or a phone pays for them.
    expect(page.indexOf('isMobileWorkspaceRequest')).toBeLessThan(page.indexOf('getMasterEnabled('))
  })

  it('still renders the desktop form on desktop', () => {
    expect(page).toContain('AutoResponseSettingsForm')
    expect(page).toContain('masterEnabled={master}')
    expect(fs.existsSync(path.join(process.cwd(), 'components/settings/autoResponse/AutoResponseSettingsForm.tsx'))).toBe(
      true,
    )
  })

  it('is declared as a real phone screen, not parked in the backlog', () => {
    expect(MOBILE_READY_ROUTES['/settings/auto-response']).toBeTruthy()
    expect(SETTINGS_MOBILE_BACKLOG['/settings/auto-response']).toBeUndefined()
  })

  it('never imports the desktop form into the mobile screen', () => {
    const mobile = fs.readFileSync(
      path.join(process.cwd(), 'modules/settings/mobile/AutoResponseMobile.tsx'),
      'utf8',
    )
    expect(mobile).not.toContain('AutoResponseSettingsForm')
    expect(mobile).not.toContain('updateAutoResponseSettings')
  })
})
