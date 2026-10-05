// @vitest-environment jsdom
/**
 * Top Ads: a video ad's thumbnail opens Meta's preview in a dialog, on click
 * only; image ads stay static; the drill-down grid is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const h = vi.hoisted(() => ({ getAdPreview: vi.fn(), throwing: false }))
// A plain function in front of the spy, so a rejecting action can be modelled
// without the spy's own bookkeeping flagging the (handled) rejection.
vi.mock('@/modules/adsReporting/actions', () => ({
  getAdPreview: (adId: string) => (h.throwing ? Promise.reject(new Error('network')) : h.getAdPreview(adId)),
}))

import AdsCreativeGrid from '@/modules/adsReporting/components/AdsCreativeGrid'
import { rowResult } from '@/lib/facebook/ads/results'
import { metricsOf } from '@/lib/facebook/ads/metrics'

const PREVIEW = 'https://www.facebook.com/ads/api/preview_iframe.php?d=AQK&t=AQI'
const row = (id: string, name: string) => {
  const m = metricsOf({ spend: '100', impressions: '1000' })
  return { id, name, spend: m.spend, result: rowResult('OUTCOME_LEADS', m) }
}
const grid = (videoPreview: boolean) => (
  <AdsCreativeGrid
    title='המודעות עם ההוצאה הגבוהה ביותר'
    rows={[row('901', 'מודעת תמונה'), row('902', 'TOF 01 | מחיר ההמתנה')]}
    creatives={{
      '901': { imageUrl: 'https://cdn/ad.jpg', isVideo: false },
      '902': { imageUrl: 'https://cdn/video-thumb.jpg', isVideo: true },
    }}
    outcomes={{}}
    currency='ILS'
    videoPreview={videoPreview}
  />
)
const card = (id: string) => document.querySelector(`[data-ad-id="${id}"]`) as HTMLElement

beforeEach(() => {
  h.getAdPreview.mockReset()
  h.throwing = false
})
afterEach(() => cleanup())

describe('Top Ads video preview', () => {
  it('only the video thumbnail is a button; nothing is fetched on render', () => {
    render(grid(true))
    expect(within(card('901')).queryByRole('button')).toBeNull()
    expect(within(card('901')).getByRole('img', { name: 'המודעה מודעת תמונה' })).toBeInTheDocument()
    const button = within(card('902')).getByRole('button', { name: 'הצגת המודעה TOF 01 | מחיר ההמתנה' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(within(button).getByRole('img', { name: 'המודעה TOF 01 | מחיר ההמתנה' })).toBeInTheDocument()
    expect(within(button).getByText('סרטון')).toBeInTheDocument()
    expect(h.getAdPreview).not.toHaveBeenCalled()
  })

  it('the drill-down grid (no videoPreview) keeps video thumbnails static', () => {
    render(grid(false))
    expect(screen.queryByRole('button')).toBeNull()
    expect(within(card('902')).getByText('סרטון')).toBeInTheDocument()
  })

  it('click → loading → Meta preview iframe; close removes it', async () => {
    let resolve!: (v: unknown) => void
    h.getAdPreview.mockReturnValue(new Promise((r) => (resolve = r)))
    render(grid(true))
    const button = within(card('902')).getByRole('button')
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button)

    const dialog = await screen.findByRole('dialog', { name: 'תצוגה מקדימה של המודעה' })
    expect(within(dialog).getByRole('status')).toHaveTextContent('טוען תצוגה מקדימה…')
    expect(h.getAdPreview).toHaveBeenCalledTimes(1)
    expect(h.getAdPreview).toHaveBeenCalledWith('902')

    await act(async () => resolve({ ok: true, url: PREVIEW }))
    const frame = within(dialog).getByTitle('תצוגה מקדימה של המודעה TOF 01 | מחיר ההמתנה')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', PREVIEW)
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(dialog.innerHTML).not.toMatch(/access_token/)

    fireEvent.click(within(dialog).getByRole('button', { name: 'סגירה' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a failed preview says so; reopening asks Meta again (nothing cached)', async () => {
    h.getAdPreview.mockResolvedValue({ ok: false })
    render(grid(true))
    fireEvent.click(within(card('902')).getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('התצוגה המקדימה לא זמינה כרגע')
    expect(within(dialog).queryByTitle(/תצוגה מקדימה של המודעה/)).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'סגירה' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(within(card('902')).getByRole('button'))
    await screen.findByRole('dialog')
    expect(h.getAdPreview).toHaveBeenCalledTimes(2)
  })

  it('a thrown action is shown as unavailable, never as a blank dialog', async () => {
    h.throwing = true
    render(grid(true))
    fireEvent.click(within(card('902')).getByRole('button'))
    expect(await screen.findByRole('alert')).toHaveTextContent('התצוגה המקדימה לא זמינה כרגע')
  })
})
