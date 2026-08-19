import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'

const TOKEN = process.env.MOBILE_QA_TOKEN || ''

test.beforeAll(() => {
  if (!TOKEN) throw new Error('MOBILE_QA_TOKEN is required.')
})

const isPhone = (name: string) => name.startsWith('phone-')

async function authCookie(context: BrowserContext, baseURL: string | undefined, token: string) {
  const url = new URL(baseURL || 'http://localhost:3100')
  await context.addCookies([
    {
      name: 'user',
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86_400,
    },
  ])
}

function readGeometry() {
  function box(el: Element | null) {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const htmlEl = el as HTMLElement
    return {
      overflowY: cs.overflowY,
      display: cs.display,
      position: cs.position,
      height: cs.height,
      minHeight: cs.minHeight,
      flexGrow: cs.flexGrow,
      clientH: htmlEl.clientHeight,
      scrollH: htmlEl.scrollHeight,
      scrollTop: htmlEl.scrollTop,
      slack: htmlEl.scrollHeight - htmlEl.clientHeight,
      rect: { top: r.top, bottom: r.bottom, height: r.height, width: r.width },
    }
  }
  const html = document.documentElement
  const body = document.body
  const main = document.getElementById('main-content')
  const header = document.querySelector('[data-testid="wa-thread-header"]')
  const thread = document.querySelector('[data-testid="wa-thread"]')
  const scroller = document.querySelector('[data-testid="wa-thread-scroller"]')
  const tab = document.querySelector('nav[aria-label="ניווט ראשי"]')
  const composer = thread?.querySelector(':scope > .shrink-0') ?? null
  const shell = document.querySelector('[data-mobile-workspace]')
  return {
    innerHeight: window.innerHeight,
    visualViewportH: window.visualViewport?.height ?? null,
    docClientH: html.clientHeight,
    docScrollH: html.scrollHeight,
    docScrollTop: html.scrollTop,
    bodyOverflowY: getComputedStyle(body).overflowY,
    bodyScrollTop: body.scrollTop,
    bodySlack: body.scrollHeight - body.clientHeight,
    htmlOverflowY: getComputedStyle(html).overflowY,
    shell: box(shell),
    main: box(main),
    header: box(header),
    thread: box(thread),
    scroller: box(scroller),
    composer: box(composer),
    tab: box(tab),
    composerToTab: composer && tab ? tab.getBoundingClientRect().top - composer.getBoundingClientRect().bottom : null,
    threadToTab: thread && tab ? tab.getBoundingClientRect().top - thread.getBoundingClientRect().bottom : null,
    headerTop: header?.getBoundingClientRect().top ?? null,
    hOverflow: document.documentElement.scrollWidth - window.innerWidth,
    desktopNav: Boolean(document.querySelector('#navPop')),
  }
}

async function openThread(page: Page) {
  await page.goto('/inbox', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 90_000 })
  const row = page.getByTestId('conversation-row').first()
  if ((await row.count()) === 0) return false
  await row.tap()
  await expect(page).toHaveURL(/conversation=/)
  await expect(page.getByTestId('wa-thread-header')).toBeVisible()
  await expect(page.getByTestId('wa-thread-scroller')).toBeVisible()
  return true
}

test.describe('mobile WhatsApp thread geometry', () => {
  test('header, composer, and tab bar stay attached; only the message list scrolls', async ({ page, context }, testInfo) => {
    test.setTimeout(180_000)
    test.skip(!isPhone(testInfo.project.name), 'phone entity only')
    await authCookie(context, testInfo.project.use.baseURL as string | undefined, TOKEN)

    const opened = await openThread(page)
    test.skip(!opened, 'no WhatsApp conversations in this workspace')

    const shotPrefix = `/tmp/wa-geom-${testInfo.project.name}`
    await page.screenshot({ path: `${shotPrefix}-before.png` })
    const afterOpen = await page.evaluate(readGeometry)
    fs.writeFileSync(`${shotPrefix}-before.json`, JSON.stringify(afterOpen, null, 2))

    expect(afterOpen.desktopNav).toBeFalsy()
    expect(afterOpen.hOverflow).toBeLessThanOrEqual(1)
    expect(afterOpen.headerTop).toBeGreaterThanOrEqual(-1)
    expect(afterOpen.headerTop).toBeLessThan(8)
    expect(afterOpen.main?.overflowY).toBe('hidden')
    expect(afterOpen.main?.scrollTop).toBe(0)
    expect(afterOpen.main?.slack ?? 0).toBeLessThanOrEqual(1)
    expect(afterOpen.docScrollTop).toBe(0)
    expect(afterOpen.bodyScrollTop).toBe(0)
    expect(afterOpen.bodySlack).toBeLessThanOrEqual(1)
    expect(afterOpen.bodyOverflowY).toMatch(/hidden|clip/)
    expect(afterOpen.composerToTab ?? 0).toBeLessThanOrEqual(2)
    expect(afterOpen.threadToTab ?? 0).toBeLessThanOrEqual(2)
    expect(afterOpen.thread?.flexGrow).toBe('1')
    expect(afterOpen.scroller?.overflowY).toMatch(/auto|scroll/)
    expect(afterOpen.tab?.position).not.toBe('sticky')
    expect(Math.abs((afterOpen.scroller?.rect.height ?? 0) - ((afterOpen.composer?.rect.top ?? 0) - (afterOpen.header?.rect.bottom ?? 0)))).toBeLessThanOrEqual(2)

    await page.evaluate(() => {
      document.documentElement.scrollTop = 240
      document.body.scrollTop = 240
      window.scrollTo(0, 240)
      const main = document.getElementById('main-content')
      if (main) main.scrollTop = 240
    })
    const afterDocScroll = await page.evaluate(readGeometry)
    expect(afterDocScroll.docScrollTop).toBe(0)
    expect(afterDocScroll.bodyScrollTop).toBe(0)
    expect(afterDocScroll.main?.scrollTop).toBe(0)
    expect(afterDocScroll.headerTop).toBeGreaterThanOrEqual(-1)
    expect(afterDocScroll.headerTop).toBeLessThan(8)
    expect(afterDocScroll.composerToTab ?? 0).toBeLessThanOrEqual(2)

    await page.evaluate(() => {
      const list = document.querySelector('[data-testid="wa-thread-scroller"]') as HTMLElement
      const probe = document.createElement('div')
      probe.setAttribute('data-testid', 'wa-scroll-probe')
      probe.style.height = '1400px'
      list.appendChild(probe)
      list.scrollTop = list.scrollHeight
    })
    const longOpen = await page.evaluate(readGeometry)
    expect(longOpen.scroller?.slack ?? 0).toBeGreaterThan(8)
    const beforeListTop = longOpen.scroller?.scrollTop ?? 0
    await page.evaluate(() => {
      const list = document.querySelector('[data-testid="wa-thread-scroller"]') as HTMLElement
      list.scrollTop = Math.max(0, list.scrollTop - 160)
    })
    const afterListScroll = await page.evaluate(readGeometry)
    expect(afterListScroll.scroller?.scrollTop ?? 0).toBeLessThan(beforeListTop - 4)
    expect(afterListScroll.main?.scrollTop).toBe(0)
    expect(afterListScroll.docScrollTop).toBe(0)
    expect(afterListScroll.bodyScrollTop).toBe(0)
    expect(afterListScroll.headerTop).toBeGreaterThanOrEqual(-1)
    expect(afterListScroll.headerTop).toBeLessThan(8)
    expect(afterListScroll.composerToTab ?? 0).toBeLessThanOrEqual(2)
    expect(afterListScroll.tab?.rect.bottom ?? 0).toBeLessThanOrEqual((afterListScroll.innerHeight ?? 0) + 2)

    await page.getByRole('link', { name: 'חזרה לשיחות' }).tap()
    await expect(page).not.toHaveURL(/conversation=/)
    await page.waitForSelector('[data-testid="conversation-row"]', { timeout: 30_000 })
    const reopened = await openThread(page)
    expect(reopened).toBeTruthy()
    const afterReturn = await page.evaluate(readGeometry)
    expect(afterReturn.main?.scrollTop).toBe(0)
    expect(afterReturn.docScrollTop).toBe(0)
    expect(afterReturn.composerToTab ?? 0).toBeLessThanOrEqual(2)
    expect(afterReturn.headerTop).toBeGreaterThanOrEqual(-1)
    expect(afterReturn.headerTop).toBeLessThan(8)

    const vp = page.viewportSize()!
    await page.setViewportSize({ width: vp.width, height: Math.max(420, Math.floor(vp.height * 0.55)) })
    const kb = await page.evaluate(readGeometry)
    expect(kb.headerTop).toBeGreaterThanOrEqual(-1)
    expect(kb.headerTop).toBeLessThan(8)
    expect(kb.composerToTab ?? 0).toBeLessThanOrEqual(2)
    expect(kb.main?.scrollTop).toBe(0)
    expect(kb.tab?.rect.bottom ?? 0).toBeLessThanOrEqual((kb.innerHeight ?? 0) + 2)
    await page.setViewportSize(vp)

    await page.screenshot({ path: `${shotPrefix}-after.png` })
    fs.writeFileSync(`${shotPrefix}-after.json`, JSON.stringify({ afterOpen, afterDocScroll, afterListScroll, afterReturn, kb }, null, 2))
  })
})
