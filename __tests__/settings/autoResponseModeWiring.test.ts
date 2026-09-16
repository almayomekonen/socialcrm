import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canUseSmartReplyAgent, isSmartReplyAgentAgencyAllowlisted, isSmartReplyAgentEnabled } from '@/lib/flags/smartReplyAgentFlags'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/**
 * The settings layer: Smart Reply selects the conversational agent, Fixed
 * Message keeps its verbatim one-shot behaviour, and the three kinds of text an
 * owner can write are told apart on screen.
 *
 * The root defect this locks: `auto_response_settings.mode` was never written by
 * any application code, so every agency sat on the column default and the
 * conversational agent was unreachable through the product.
 */

describe('mode is actually written now', () => {
  it('the settings action derives mode from the chosen reply style', () => {
    const src = read('actions/autoResponse/updateSettings.ts')
    expect(src).toContain('function modeForReplyMode')
    expect(src).toContain("if (replyMode === 'fixed') return 'acknowledge'")
    expect(src).toContain("canUseSmartReplyAgent(agencyId) ? 'qualify' : undefined")
    expect(src).toContain('mode: modeForReplyMode(replyMode, user.agencyId)')
  })

  it('the db layer persists mode and agentInstructions', () => {
    const src = read('db/autoResponseSettings.ts')
    expect(src).toContain('agentInstructions')
    expect(src).toMatch(/if \(input\.mode !== undefined\)/)
    expect(src).toContain("optional.mode = input.mode === 'qualify' ? 'qualify' : 'acknowledge'")
  })

  it('an omitted mode leaves the stored value alone', () => {
    // A caller that does not manage mode must not silently reset an agency that
    // is already on 'qualify'. Both insert and merge take the same `shared`
    // object, and `mode` only joins it when a value was supplied.
    const src = read('db/autoResponseSettings.ts')
    expect(src).toContain('const optional: Record<string, unknown> = {}')
    expect(src).toContain('...optional,')
    expect(src).toContain('.merge(shared)')
  })

  it('reads mode and agentInstructions back', () => {
    const src = read('db/autoResponseSettings.ts')
    expect(src).toMatch(/'guidance',\s*\n\s*'agentInstructions',\s*\n\s*'businessProfile',\s*\n\s*'mode',/)
    expect(src).toContain('agentInstructions: row.agentInstructions ?? null')
  })
})

describe('existing customers are not migrated by this change', () => {
  const env = (enabled?: string, ids?: string) => {
    const prev = { e: process.env.SMART_REPLY_AGENT_ENABLED, i: process.env.SMART_REPLY_AGENT_AGENCY_IDS }
    if (enabled === undefined) delete process.env.SMART_REPLY_AGENT_ENABLED
    else process.env.SMART_REPLY_AGENT_ENABLED = enabled
    if (ids === undefined) delete process.env.SMART_REPLY_AGENT_AGENCY_IDS
    else process.env.SMART_REPLY_AGENT_AGENCY_IDS = ids
    return () => {
      if (prev.e === undefined) delete process.env.SMART_REPLY_AGENT_ENABLED
      else process.env.SMART_REPLY_AGENT_ENABLED = prev.e
      if (prev.i === undefined) delete process.env.SMART_REPLY_AGENT_AGENCY_IDS
      else process.env.SMART_REPLY_AGENT_AGENCY_IDS = prev.i
    }
  }

  it('ABSENCE BLOCKS — no env, no agency', () => {
    const restore = env()
    try {
      expect(isSmartReplyAgentEnabled()).toBe(false)
      expect(canUseSmartReplyAgent(103)).toBe(false)
    } finally {
      restore()
    }
  })

  it('the master switch alone is not enough', () => {
    const restore = env('1', '')
    try {
      expect(isSmartReplyAgentEnabled()).toBe(true)
      expect(isSmartReplyAgentAgencyAllowlisted(103)).toBe(false)
      expect(canUseSmartReplyAgent(103)).toBe(false)
    } finally {
      restore()
    }
  })

  it('the allowlist alone is not enough', () => {
    const restore = env(undefined, '103')
    try {
      expect(canUseSmartReplyAgent(103)).toBe(false)
    } finally {
      restore()
    }
  })

  it('both together name exactly one agency', () => {
    const restore = env('1', '103')
    try {
      expect(canUseSmartReplyAgent(103)).toBe(true)
      expect(canUseSmartReplyAgent(9001)).toBe(false)
      expect(canUseSmartReplyAgent(null)).toBe(false)
    } finally {
      restore()
    }
  })

  it('no migration rewrites existing rows', () => {
    const dir = path.join(process.cwd(), 'migrations')
    const mine = fs.readFileSync(path.join(dir, '20260916000001_auto_response_agent_instructions.cjs'), 'utf8')
    expect(mine).toContain('ADD COLUMN "agentInstructions" text')
    // Additive only: it reads no existing value and updates no row.
    expect(mine).not.toMatch(/UPDATE\s+auto_response_settings/i)
    expect(mine).not.toMatch(/\bSET\s+mode\b/i)
  })
})

describe('the three kinds of text are told apart on screen', () => {
  const form = read('components/settings/autoResponse/AutoResponseReplyStyle.tsx')
  const field = read('components/settings/autoResponse/AutoResponseTextField.tsx')

  it('every field says whether the customer receives it', () => {
    expect(field).toContain("sent ? 'הטקסט הזה נשלח ללקוח כלשונו' : 'הטקסט הזה לא נשלח ללקוח'")
  })

  it('business information and agent instructions are separate fields, neither sent', () => {
    expect(form).toContain("label='ספרו לסוכן על העסק ומה תרצו שיעשה'")
    expect(form).toContain("label='הנחיות נוספות לסוכן'")
    const aiBlock = form.slice(form.indexOf("replyMode === 'ai' ? ("), form.indexOf(') : ('))
    expect(aiBlock).toContain('sent={false}')
    expect(aiBlock).not.toContain('sent\n')
  })

  it('the fixed message is the only one marked as sent', () => {
    expect(form).toContain("label='ההודעה שתישלח'")
    expect(form.match(/sent$/gm) ?? []).toHaveLength(1)
  })

  it('one textarea no longer flips meaning between two very different jobs', () => {
    expect(form).not.toContain("value={replyMode === 'ai' ? guidance : fixedBody}")
    expect(form).not.toContain("set(replyMode === 'ai' ? 'guidance' : 'fixedBody', e.target.value)")
  })

  it('saved content is preserved — both values are held and submitted', () => {
    expect(read('components/settings/autoResponse/AutoResponseSettingsForm.tsx')).toContain('guidance: guidance.trim() || null')
    expect(read('components/settings/autoResponse/AutoResponseSettingsForm.tsx')).toContain('agentInstructions: agentInstructions.trim() || null')
    expect(read('components/settings/autoResponse/AutoResponseSettingsForm.tsx')).toContain('fixedBody: fixedBody.trim() || null')
  })
})
