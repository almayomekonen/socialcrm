'use client'

import type { PopoverDOM } from 'driver.js'

/** The look and behaviour every SocialCRM Driver.js run shares (overlay, stage, keyboard, motion). */
export function baseDriverConfig(reduceMotion: boolean) {
  return {
    animate: !reduceMotion,
    smoothScroll: !reduceMotion,
    allowClose: true,
    allowKeyboardControl: true,
    allowScroll: true,
    overlayColor: '#0a2540',
    overlayOpacity: 0.45,
    overlayClickBehavior: 'close' as const,
    stagePadding: 8,
    stageRadius: 12,
    popoverOffset: 12,
  }
}

/**
 * The SocialCRM chrome Driver.js does not provide on its own: dialog semantics,
 * an accessible name, the direction, and one extra footer button (skip / later).
 * Shared by the tours and the first-time Help spotlight.
 */
export function decorateTourPopover(
  popover: PopoverDOM,
  opts: { label: string; extra: { text: string; onClick: () => void } },
): void {
  popover.wrapper.setAttribute('dir', 'rtl')
  popover.wrapper.setAttribute('role', 'dialog')
  popover.wrapper.setAttribute('aria-modal', 'true')
  popover.wrapper.setAttribute('aria-label', opts.label)
  const extra = document.createElement('button')
  extra.type = 'button'
  extra.className = 'edu-popover-skip'
  extra.textContent = opts.extra.text
  extra.addEventListener('click', opts.extra.onClick)
  popover.footerButtons.appendChild(extra)
}
