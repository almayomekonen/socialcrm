import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getTour } from '@/lib/education/registry'
import { LEAD_OPEN_EDU, eduSel } from '@/lib/education/types'
import { presentSteps, waitForTourTargets } from '@/lib/education/presentSteps'
import { isTourEligible } from '@/lib/education/eligibility'
import { FIRST_RUN_COPY } from '@/lib/activation/firstRunCopy'
import type { EligibilityContext } from '@/lib/education/types'

const el = () => ({}) as Element

const PIPELINE_TITLES = ['הרשימה', 'סטטוסים', 'פתיחת ליד', 'ליד חדש', 'זה כל הרעיון'] as const

const desktop: EligibilityContext = {
  surface: 'desktop',
  toursEnabled: true,
  copilotEnabled: true,
  firstLeadActive: false,
  pathname: '/leads',
  force: true,
}

describe('leads tour sequence', () => {
  it('walks the daily list workflow in this exact order', () => {
    const pipeline = getTour('pipeline')!
    expect(pipeline.version).toBe(2)
    expect(pipeline.auto).toBe(true)
    expect(pipeline.steps.map((s) => s.title)).toEqual([...PIPELINE_TITLES])
    expect(pipeline.steps.map((s) => s.element)).toEqual([
      eduSel('leads-table'),
      eduSel('lead-status-tabs'),
      eduSel(LEAD_OPEN_EDU),
      eduSel('leads-add'),
      undefined,
    ])
  })

  it('does not include export, bulk, follow-up, search, sort, or overview pipeline-nav', () => {
    const pipeline = getTour('pipeline')!
    const blob = JSON.stringify(pipeline.steps)
    expect(blob).not.toMatch(/export|excel|pdf|ייצוא/i)
    expect(blob).not.toMatch(/bulk|מחק הכל|פעולות/)
    expect(pipeline.steps.some((s) => s.element === eduSel('lead-followup'))).toBe(false)
    expect(pipeline.steps.some((s) => s.title === 'הפייפליין')).toBe(false)
    expect(pipeline.steps.some((s) => s.element === eduSel('nav-leads'))).toBe(false)
    expect(pipeline.steps).toHaveLength(5)
  })

  it('keeps Add after open, and closes without a spotlight', () => {
    const steps = getTour('pipeline')!.steps
    expect(steps[3]?.element).toBe(eduSel('leads-add'))
    expect(steps[3]?.title).toBe('ליד חדש')
    expect(steps[4]?.element).toBeUndefined()
    expect(steps[4]?.title).toBe('זה כל הרעיון')
  })
})

describe('lead-open target', () => {
  it('anchors the existing lead name link on the Leads table only', () => {
    const table = readFileSync('components/clients/clientsTable.tsx', 'utf8')
    expect(table).toContain('data-edu={forLeads ? LEAD_OPEN_EDU : undefined}')
    expect(table).toContain('href={`/clients/${obj.id}/summary`}')
    expect(table).toContain('formatName: (name, obj) => formatName(name, obj, leads)')
  })

  it('gives a populated desktop table the full five steps', () => {
    const query = (sel: string) => {
      if (sel === eduSel('leads-table')) return el()
      if (sel === eduSel('lead-status-tabs')) return el()
      if (sel === eduSel(LEAD_OPEN_EDU)) return el()
      if (sel === eduSel('leads-add')) return el()
      return null
    }
    expect(presentSteps(getTour('pipeline')!.steps, query).map((s) => s.title)).toEqual([...PIPELINE_TITLES])
  })

  it('omits lead-open when no row exists rather than inventing a target', () => {
    const query = (sel: string) => {
      if (sel === eduSel(LEAD_OPEN_EDU)) return null
      if (sel === eduSel('leads-table') || sel === eduSel('lead-status-tabs') || sel === eduSel('leads-add')) return el()
      return null
    }
    const titles = presentSteps(getTour('pipeline')!.steps, query).map((s) => s.title)
    expect(titles).toEqual(['הרשימה', 'סטטוסים', 'ליד חדש', 'זה כל הרעיון'])
    expect(titles).not.toContain('פתיחת ליד')
  })

  it('waits for lead-open with the existing readiness poll, not the table wrapper', async () => {
    let found = false
    let t = 0
    const queue: Array<() => void> = []
    const pending = waitForTourTargets(getTour('pipeline')!.steps, {
      query: (sel) => {
        if (sel === eduSel('leads-table') || sel === eduSel('lead-status-tabs') || sel === eduSel('leads-add')) return el()
        if (found && sel === eduSel(LEAD_OPEN_EDU)) return el()
        return null
      },
      timeoutMs: 1000,
      now: () => t,
      schedule: (cb) => {
        queue.push(cb)
        return queue.length
      },
    })
    expect(queue).toHaveLength(1)
    found = true
    t += 16
    queue.shift()?.()
    await expect(pending).resolves.toBe(true)
  })

  it('still starts the remaining steps if lead-open never appears', async () => {
    let t = 0
    const queue: Array<() => void> = []
    const pending = waitForTourTargets(getTour('pipeline')!.steps, {
      query: (sel) => {
        if (sel === eduSel('leads-table') || sel === eduSel('leads-add')) return el()
        return null
      },
      timeoutMs: 40,
      now: () => t,
      schedule: (cb) => {
        queue.push(cb)
        return 1
      },
    })
    expect(queue).toHaveLength(1)
    t = 40
    queue.shift()?.()
    await expect(pending).resolves.toBe(true)
  })
})

describe('leads tour boundaries', () => {
  it('leaves LeadsFirstRun, FirstLeadCallout, Lead tour, and Overview unchanged', () => {
    const firstRun = readFileSync('components/clients/LeadsFirstRun.tsx', 'utf8')
    expect(firstRun).not.toContain('data-edu')
    expect(firstRun).toContain('data-leads-empty')
    expect(firstRun).toContain('data-add-lead')
    // The two first-run actions still exist, but their copy now lives in
    // `lib/activation/firstRunCopy.ts` (shared with the mobile first-run screen),
    // so the component no longer carries the literal strings this used to grep
    // for. Assert the copy module instead: same guarantee — an import action and
    // an add action, both named — without pinning where the text is declared, and
    // without asserting copy the first-run rewrite deliberately replaced.
    expect(FIRST_RUN_COPY.own.import.title.length).toBeGreaterThan(0)
    expect(FIRST_RUN_COPY.own.add.title.length).toBeGreaterThan(0)

    const callout = readFileSync('components/clients/FirstLeadCallout.tsx', 'utf8')
    expect(callout).not.toContain('driver.js')
    expect(callout).toContain("t('leadDetail.firstLead.title')")
    expect(callout).toContain("t('leadDetail.firstLead.body')")

    const lead = getTour('lead')!
    expect(lead.version).toBe(1)
    expect(lead.steps.map((s) => s.element)).toEqual([eduSel('lead-status'), eduSel('lead-followup')])

    const overview = getTour('overview')!
    expect(overview.version).toBe(3)
    expect(overview.steps).toHaveLength(13)
    expect(overview.steps.some((s) => s.element === eduSel('leads-table'))).toBe(false)
  })

  it('stays desktop-only, including Help replay', () => {
    const pipeline = getTour('pipeline')!
    expect(isTourEligible(pipeline, desktop)).toBe(true)
    expect(isTourEligible(pipeline, { ...desktop, force: false })).toBe(true)
    expect(isTourEligible(pipeline, { ...desktop, surface: 'mobile' })).toBe(false)
    expect(isTourEligible(pipeline, { ...desktop, surface: 'mobile', force: true })).toBe(false)
  })

  it('does not route-change for Help on /leads', () => {
    const help = readFileSync('components/education/HelpMenu.tsx', 'utf8')
    const handler = help.split("lbl='סיור בלידים'")[1]?.split("lbl='מדריכים'")[0] ?? ''
    expect(handler).toContain("startTour('pipeline'")
    expect(handler).toContain("pathname.startsWith('/leads')")
  })

  it('keeps Hebrew RTL chrome and a transparent overlay', () => {
    const css = readFileSync('lib/css/education.css', 'utf8')
    expect(css).toMatch(/\.driver-overlay\s*\{[^}]*background:\s*transparent/)
    expect(css).toMatch(/\.edu-popover\s*\{[^}]*direction:\s*rtl/)
    const runTour = readFileSync('components/education/runTour.ts', 'utf8')
    expect(runTour).toContain("doneBtnText: 'הבנתי'")
    expect(runTour).toMatch(/setAttribute\('dir',\s*'rtl'\)/)
    for (const step of getTour('pipeline')!.steps) {
      expect(/[\u0590-\u05FF]/.test(step.title)).toBe(true)
      expect(/[\u0590-\u05FF]/.test(step.description)).toBe(true)
      expect(step.title).not.toMatch(/[A-Za-z]{4,}/)
    }
  })
})
