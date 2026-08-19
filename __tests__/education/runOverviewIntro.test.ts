// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HELP_TRIGGER_EDU, eduSel } from '@/lib/education/types'
import { __resetTourLockForTests, acquireTourLock, isTourLockHeld } from '@/lib/education/tourLock'

const driverState = vi.hoisted(() => ({
  config: null as any,
  instance: null as any,
}))

vi.mock('driver.js', () => ({
  driver: (config: any) => {
    driverState.config = config
    driverState.instance = {
      drive: vi.fn(),
      destroy: vi.fn(() => {
        config.onDestroyed?.()
      }),
      getActiveIndex: () => 0,
      isLastStep: () => true,
    }
    return driverState.instance
  },
}))

vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('@/lib/css/education.css', () => ({}))

import { runOverviewIntro } from '@/components/education/runTour'

function mountHelpTrigger() {
  const btn = document.createElement('button')
  btn.setAttribute('data-edu', HELP_TRIGGER_EDU)
  btn.setAttribute('aria-label', 'עזרה')
  document.body.appendChild(btn)
  return btn
}

function fakePopover() {
  const footerButtons = document.createElement('div')
  const wrapper = document.createElement('div')
  const title = document.createElement('h2')
  title.textContent = 'ברוכים הבאים ל־SocialCRM'
  return {
    wrapper,
    title,
    footerButtons,
    arrow: document.createElement('div'),
    description: document.createElement('p'),
    footer: document.createElement('div'),
    progress: document.createElement('div'),
    previousButton: document.createElement('button'),
    nextButton: document.createElement('button'),
    closeButton: document.createElement('button'),
  }
}

beforeEach(() => {
  __resetTourLockForTests()
  driverState.config = null
  driverState.instance = null
  document.body.innerHTML = ''
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
  })
})

afterEach(() => {
  __resetTourLockForTests()
  document.body.innerHTML = ''
})

describe('runOverviewIntro', () => {
  it('spotlights only the Help trigger with the invitation copy and no progress', async () => {
    mountHelpTrigger()
    const pending = runOverviewIntro()
    await vi.waitFor(() => expect(driverState.config).toBeTruthy())
    expect(driverState.config.showProgress).toBe(false)
    expect(driverState.config.disableActiveInteraction).toBe(true)
    expect(driverState.config.doneBtnText).toBe('התחל סיור')
    expect(driverState.config.nextBtnText).toBe('התחל סיור')
    expect(driverState.config.showButtons).toEqual(['next'])
    expect(driverState.config.overlayClickBehavior).toBe('close')
    expect(driverState.config.steps).toHaveLength(1)
    expect(driverState.config.steps[0].element).toBe(eduSel(HELP_TRIGGER_EDU))
    expect(driverState.config.steps[0].popover.title).toBe('ברוכים הבאים ל־SocialCRM')
    expect(driverState.config.steps[0].popover.description).toBe('רוצה סיור קצר במערכת?')
    expect(driverState.config.steps[0].popover.showProgress).toBe(false)
    expect(driverState.config.popoverClass).toContain('edu-popover-intro')
    expect(driverState.instance.drive).toHaveBeenCalledWith(0)

    const popover = fakePopover()
    driverState.config.onPopoverRender(popover)
    expect(popover.wrapper.getAttribute('dir')).toBe('rtl')
    expect(popover.footerButtons.textContent).toContain('אולי אחר כך')
    expect(popover.footerButtons.textContent).not.toContain('דלג')
    expect(popover.wrapper.getAttribute('aria-label')).toBe('ברוכים הבאים ל־SocialCRM')

    driverState.config.onCloseClick()
    await expect(pending).resolves.toBe('declined')
    expect(isTourLockHeld()).toBe(false)
  })

  it('accepts via the primary CTA and releases the lock', async () => {
    mountHelpTrigger()
    const pending = runOverviewIntro()
    await vi.waitFor(() => expect(driverState.config).toBeTruthy())
    driverState.config.onDoneClick()
    await expect(pending).resolves.toBe('accepted')
    expect(isTourLockHeld()).toBe(false)
  })

  it('declines via the secondary CTA', async () => {
    mountHelpTrigger()
    const pending = runOverviewIntro()
    await vi.waitFor(() => expect(driverState.config).toBeTruthy())
    const popover = fakePopover()
    driverState.config.onPopoverRender(popover)
    popover.footerButtons.querySelector('button')?.click()
    await expect(pending).resolves.toBe('declined')
  })

  it('treats overlay close / Escape as declined', async () => {
    mountHelpTrigger()
    const pending = runOverviewIntro()
    await vi.waitFor(() => expect(driverState.config).toBeTruthy())
    driverState.config.onCloseClick()
    await expect(pending).resolves.toBe('declined')
  })

  it('does not steal an active tour lock', async () => {
    mountHelpTrigger()
    expect(acquireTourLock()).toBe(true)
    await expect(runOverviewIntro()).resolves.toBeNull()
    expect(driverState.config).toBeNull()
    expect(isTourLockHeld()).toBe(true)
  })
})
