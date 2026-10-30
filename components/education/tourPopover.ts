'use client'

import type { PopoverDOM } from 'driver.js'
import { regionAttrs } from '@/lib/i18n/config'
import type { Translator } from '@/lib/i18n/translate'

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
  opts: { label: string; extra: { text: string; onClick: () => void }; t?: Translator },
): void {
  // The popover sits in <body>, outside every language island, so it declares
  // its own language. Hebrew keeps exactly the attribute it always had.
  const t = opts.t
  if (t && t.locale !== 'he') {
    const region = regionAttrs(t.locale)
    popover.wrapper.setAttribute('lang', region.lang!)
    popover.wrapper.setAttribute('dir', region.dir!)
    // Driver.js names its × button "Close" in every language.
    popover.closeButton.setAttribute('aria-label', t('common.dialog.close'))
  } else {
    popover.wrapper.setAttribute('dir', 'rtl')
  }
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
