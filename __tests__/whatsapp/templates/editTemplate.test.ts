import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Safe edit-in-place: admin + agency-scoped, APPROVED only, category & arity
 * preserved. An unsupported shape change routes to create-new and NEVER mutates.
 * A failed Meta edit never touches local content. Token never in the result.
 * `validate` / `buildComponents` / arity run for real; leaves are mocked.
 */

const h = vi.hoisted(() => ({
  requireAgencyUser: vi.fn(),
  isAdmin: vi.fn(),
  editTemplateOnMeta: vi.fn(),
  loadTemplateForEdit: vi.fn(),
  updateTemplateContent: vi.fn(),
  connection: undefined as { access_token: string } | undefined,
}))

vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: h.requireAgencyUser }))
vi.mock('@/types/roles', () => ({ isAdmin: h.isAdmin }))
vi.mock('@/lib/whatsapp/templates/graph', () => ({ editTemplateOnMeta: h.editTemplateOnMeta }))
vi.mock('@/db/whatsappTemplates', () => ({
  loadTemplateForEdit: h.loadTemplateForEdit,
  updateTemplateContent: h.updateTemplateContent,
}))
vi.mock('@/config/db', () => {
  const b: Record<string, unknown> = {}
  Object.assign(b, { where: () => b, first: async () => h.connection })
  return { db: () => b }
})

const { editTemplate } = await import('@/actions/whatsapp/templates/editTemplate')

// Existing APPROVED template: UTILITY, one chip (arity 1).
const EXISTING = {
  id: 5,
  status: 'approved' as const,
  name: 'ready_message_2',
  language: 'he',
  metaTemplateId: 'MT_5',
  category: 'UTILITY',
  bodyText: 'היי שם הליד, קיבלנו את הפרטים שלך.',
  variables: [{ token: 'שם הליד', sample: 'דוד' }],
}
// A valid same-shape edit (still UTILITY, still one chip = arity 1).
const EDIT_INPUT = {
  displayTitle: 'אישור קבלת פרטים',
  bodyText: 'היי שם הליד, קיבלנו את הפרטים שלך ונחזור אליך.',
  purpose: 'UTILITY' as const,
  variables: [{ token: 'שם הליד', sample: 'דוד' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAgencyUser.mockResolvedValue({ id: 7, agencyId: 103, role: 'admin' })
  h.isAdmin.mockReturnValue(true)
  h.loadTemplateForEdit.mockResolvedValue(EXISTING)
  h.connection = { access_token: 'secret-token' }
  h.editTemplateOnMeta.mockResolvedValue({ ok: true })
  h.updateTemplateContent.mockResolvedValue({ id: 5, displayTitle: 'אישור קבלת פרטים', status: 'approved', bodyText: 'x', variables: [], failureText: null, archived: false, createdAt: '2026-07-25T00:00:00Z' })
})

describe('editTemplate — permission & status', () => {
  it('non-admin is rejected before any Meta call', async () => {
    h.isAdmin.mockReturnValue(false)
    const res = await editTemplate(5, EDIT_INPUT)
    expect(res).toEqual({ ok: false, error: 'אין הרשאה לערוך הודעות מוכנות.' })
    expect(h.editTemplateOnMeta).not.toHaveBeenCalled()
  })

  it('loads scoped to the caller agency', async () => {
    await editTemplate(5, EDIT_INPUT)
    expect(h.loadTemplateForEdit).toHaveBeenCalledWith(5, 103)
  })

  it('a non-approved (pending) template cannot be edited', async () => {
    h.loadTemplateForEdit.mockResolvedValue({ ...EXISTING, status: 'pending' })
    const res = await editTemplate(5, EDIT_INPUT)
    expect(res).toEqual({ ok: false, error: 'אפשר לערוך רק הודעה שאושרה.' })
    expect(h.editTemplateOnMeta).not.toHaveBeenCalled()
  })

  it('not found → NOT_FOUND', async () => {
    h.loadTemplateForEdit.mockResolvedValue(null)
    expect(await editTemplate(5, EDIT_INPUT)).toEqual({ ok: false, error: 'ההודעה המוכנה לא נמצאה.' })
  })
})

describe('editTemplate — same-shape guards (route to create-new, never mutate)', () => {
  it('a category change is refused with needsNew and does NOT edit', async () => {
    const res = await editTemplate(5, { ...EDIT_INPUT, purpose: 'MARKETING' })
    expect(res).toEqual({ ok: false, error: 'שינוי מטרת ההודעה דורש יצירת הודעה חדשה.', needsNew: true })
    expect(h.editTemplateOnMeta).not.toHaveBeenCalled()
    expect(h.updateTemplateContent).not.toHaveBeenCalled()
  })

  it('a parameter-arity change (1 → 2) is refused with needsNew and does NOT edit', async () => {
    const res = await editTemplate(5, {
      ...EDIT_INPUT,
      bodyText: 'היי שם הליד, מ־שם העסק',
      variables: [{ token: 'שם הליד', sample: 'דוד' }, { token: 'שם העסק', sample: 'עסק' }],
    })
    expect(res).toEqual({ ok: false, error: 'שינוי מספר הפרטים האישיים בהודעה דורש יצירת הודעה חדשה.', needsNew: true })
    expect(h.editTemplateOnMeta).not.toHaveBeenCalled()
    expect(h.updateTemplateContent).not.toHaveBeenCalled()
  })
})

describe('editTemplate — happy path', () => {
  it('edits the SAME Meta template with components only, then updates local content', async () => {
    const res = await editTemplate(5, EDIT_INPUT)
    expect(res.ok).toBe(true)
    // Meta edit targeted the existing template id, components-only.
    const [metaId, token, args] = h.editTemplateOnMeta.mock.calls[0]
    expect(metaId).toBe('MT_5')
    expect(token).toBe('secret-token')
    expect(args.components[0].type).toBe('BODY')
    expect(args.components[0].text).toContain('{{1}}')
    // Local content updated after Meta accepted.
    expect(h.updateTemplateContent).toHaveBeenCalledTimes(1)
    expect(h.updateTemplateContent.mock.calls[0].slice(0, 2)).toEqual([5, 103])
  })

  it('never leaks the access token in the result', async () => {
    const res = await editTemplate(5, EDIT_INPUT)
    expect(JSON.stringify(res)).not.toContain('secret-token')
  })
})

describe('editTemplate — failure never mutates local content', () => {
  it('a failed Meta edit returns the mapped error and does NOT update local content', async () => {
    h.editTemplateOnMeta.mockResolvedValue({ ok: false, error: 'ההודעה כבר נערכה לאחרונה. אפשר לערוך אותה שוב מאוחר יותר.' })
    const res = await editTemplate(5, EDIT_INPUT)
    expect(res).toEqual({ ok: false, error: 'ההודעה כבר נערכה לאחרונה. אפשר לערוך אותה שוב מאוחר יותר.' })
    expect(h.updateTemplateContent).not.toHaveBeenCalled()
  })

  it('no connection token → CONNECT error, no Meta call', async () => {
    h.connection = undefined
    const res = await editTemplate(5, EDIT_INPUT)
    expect(res).toEqual({ ok: false, error: 'צריך לחבר וואטסאפ עסקי כדי לערוך הודעות.' })
    expect(h.editTemplateOnMeta).not.toHaveBeenCalled()
  })
})
