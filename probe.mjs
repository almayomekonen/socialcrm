import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const SP = '/private/tmp/claude-501/-Users-User-Documents-social-crm/57d6ac71-fa4b-4074-a839-0559be756f33/scratchpad'
const b = await chromium.launch()
const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1200, height: 1150 } })
const page = await ctx.newPage()
await page.goto(readFileSync(`${SP}/welcome.txt`,'utf8').trim(), { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
console.log('after sign-in at:', page.url())
console.log('TEXT:', (await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,400))))
console.log('checkboxes:', await page.evaluate(() => document.querySelectorAll('input[type=checkbox]').length))
await page.screenshot({ path: `${SP}/after-signin.png` })
