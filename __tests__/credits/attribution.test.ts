/**
 * Every AI usage path has a deliberate category. New task kinds fail to compile
 * until classified (lib/credits/aiCategories.ts); this file covers the rest.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { aiUsageCategory } from '@/lib/credits/aiCategories'

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
const FILES = ['lib', 'actions', 'app', 'db'].flatMap((d) => sources(d))

describe('categories', () => {
  it.each(['wa_assistant_job', 'agent_investigation', 'voice.transcribe', 'agent.investigate', 'copilot.classifyIntent', 'copilot.generalReason', 'lead.askQuestion', 'lead.followup', 'lead.nextStep'])('%s is owner-initiated', (k) => {
    expect(aiUsageCategory(k)).toBe('agent')
  })
  it.each(['auto_response_job', 'conversation_analysis_job', 'inbox.autoResponse', 'conversation.analysis', 'lead.summary', 'lead.classify', 'pipeline.weekly', 'health.check'])('%s is automation', (k) => {
    expect(aiUsageCategory(k)).toBe('automation')
  })
  it('an unknown kind is unclassified', () => {
    expect(aiUsageCategory('brand_new_job')).toBe('unclassified')
  })
  it('every operation the code names itself is classified', () => {
    const named = new Set<string>()
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/(?:withAiOperation\(\s*\{\s*|fallbackOperation: \{ |\brun: \{ )kind: '([^']+)'/g)) named.add(m[1])
    }
    expect([...named].sort()).toEqual(['agent_investigation', 'auto_response_job', 'conversation_analysis_job', 'voice.transcribe', 'wa_assistant_job'])
    for (const k of named) expect(aiUsageCategory(k)).not.toBe('unclassified')
  })
})

describe('the credit system sends nothing', () => {
  it('no credit module imports a WhatsApp sender or the owner notifier', () => {
    const credit = FILES.filter((f) => /^(db|lib)\/credits\/|^app\/api\/cron\/usage-credits\/|^actions\/credits/.test(f))
    expect(credit.length).toBeGreaterThan(8)
    for (const f of credit) expect(readFileSync(f, 'utf8')).not.toMatch(/sendPlatformText|sendWhatsapp|graph\.facebook|notifyOwnerReminder|notifyAgencyOwner/)
  })
  it('credits are granted only from the Grow-confirmed success path', () => {
    const callers = FILES.filter((f) => /grantCreditPack\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('db/credits/purchases.ts'))
    expect(callers).toEqual(['lib/payments/charges/applySuccessfulCharge.ts'])
    const success = FILES.filter((f) => /applySuccessfulCharge\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('applySuccessfulCharge.ts')).sort()
    expect(success).toEqual(['lib/payments/charges/executeCharge.ts', 'lib/payments/charges/reconcileUnknown.ts'])
  })
  it('reminder delivery does not reference credits', () => {
    for (const f of FILES.filter((x) => /^db\/ownerPersonalReminders\/|^lib\/reminders\/delivery\//.test(x))) expect(readFileSync(f, 'utf8')).not.toMatch(/credits/i)
  })
})
