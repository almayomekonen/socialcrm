// @vitest-environment jsdom
//
// Prints the shell's rendered DOM so the chrome can be reviewed as a product
// surface, not only asserted against. Kept as a test rather than a script so it
// runs in the same environment as everything else and cannot drift.

import { test } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import SupportShell from '@/components/support/SupportShell'

test('rendered shell (visual review aid)', () => {
  const { container } = render(
    <SupportShell user={{ name: 'דנה לוי', email: 'dana@abc.co.il', role: 'AGNT' } as any}>
      <h1 className='text-2xl font-bold text-ink'>מרכז התמיכה</h1>
      <p className='mt-1 text-sm text-gray-500'>משהו לא עובד כמו שצריך? אנחנו כאן כדי לעזור.</p>
    </SupportShell>,
  )

  const pretty = container.innerHTML
    .replace(/></g, '>\n<')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')

  console.log('\n===== RENDERED SUPPORT SHELL =====\n' + pretty + '\n===== END =====\n')
  console.log('TEXT CONTENT:', JSON.stringify(container.textContent))
})
