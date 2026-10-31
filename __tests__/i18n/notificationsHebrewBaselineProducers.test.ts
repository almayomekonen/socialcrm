import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { NOW, everyEmittedShape, legacyRows } from './notificationsEnv'

/**
 * HEBREW BASELINE for the notification label producers (i18n Phase F3), a JSON
 * snapshot recorded BEFORE Phase F3: the category labels, the bell's accessible
 * name for every threshold, the relative times the rows print, the center's
 * filter vocabulary and URLs, and the exact title / body every emitter writes
 * for every shape (the stored text a read-time mapping must reproduce).
 */

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())

describe('Hebrew baseline — notification producers', () => {
  test('labels, bell names, relative times, filter URLs', async () => {
    const { CATEGORY_LABEL, CATEGORY_ICON, bellLabel } = await import('@/modules/notifications/dropdown')
    const { CENTER_CATEGORY_ORDER, centerHref, parseCenterFilters } = await import('@/modules/notifications/center')
    const { timeAgo } = await import('@/components/settings/connections/copy')
    const minutes = [0, 0.5, 1, 5, 59, 60, 61, 60 * 23, 60 * 24, 60 * 47, 60 * 48, 60 * 24 * 30, -5]
    expect({
      CATEGORY_LABEL,
      CATEGORY_ICON,
      CENTER_CATEGORY_ORDER,
      bell: Object.fromEntries([0, 1, 2, 3, 10, 99, 100, 1500].map((n) => [n, bellLabel(n)])),
      timeAgo: Object.fromEntries(minutes.map((m) => [m, timeAgo(new Date(NOW - m * 60_000).toISOString())])),
      timeAgoNull: timeAgo(null),
      hrefs: [
        centerHref({ unreadOnly: false, category: null }),
        centerHref({ unreadOnly: true, category: 'leads' }),
        centerHref(parseCenterFilters({ unread: 'true', category: 'nope' })),
      ],
    }).toMatchSnapshot()
  })

  test('the stored text of every emitter shape (and the legacy rows)', () => {
    const rows = [...everyEmittedShape(), ...legacyRows()].map((r) => ({
      type: r.type,
      category: r.category,
      title: r.title,
      body: r.body,
      deepLink: r.deepLink,
      groupCount: r.groupCount,
    }))
    expect(rows.find((r) => r.type === 'message.messenger_inbound')?.title).toBe('הודעת Messenger חדשה — Almayo Mekonen')
    expect(rows).toMatchSnapshot()
  })
})
