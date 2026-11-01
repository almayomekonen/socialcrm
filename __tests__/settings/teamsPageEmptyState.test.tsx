// @vitest-environment jsdom
//
// Settings → צוותים with no teams.
//
// The page used to return only "אין צוותים עדיין" when an agency had zero
// teams, which never rendered TeamCard and so hid its "הוספת צוות" button: the
// first team could not be created from the UI at all. These tests pin that the
// create action is always there, with the empty message beside it, and that a
// non-empty list renders exactly as before.
//
//   NODE_ENV=test VITEST_NO_DB=1 pnpm exec vitest run __tests__/settings/teamsPageEmptyState.test.tsx

import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const H = vi.hoisted(() => ({
  getAllTeams: vi.fn(),
  getUsers: vi.fn(),
}))

vi.mock('@/db/usersNTeams', () => ({ getAllTeams: H.getAllTeams, getUsers: H.getUsers }))
// The create/delete server actions are not under test; the form must only be reachable.
vi.mock('@/actions/usersNteams', () => ({ upsertTeam: vi.fn(), deleteTeam: vi.fn() }))

import EditTeamsPage from '@/app/(he)/(app)/settings/(admin_settings)/edit_teams/page'

const USERS = [
  { id: 1, name: 'דנה', role: 'AGNT' },
  { id: 2, name: 'יוסי', role: 'MNGR' },
  { id: 3, name: 'רוני', role: 'OFFICE' },
]

async function renderPage() {
  render(await EditTeamsPage())
}

beforeEach(() => {
  H.getUsers.mockResolvedValue(USERS)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Settings → צוותים', () => {
  it('with zero teams, shows the empty message and the create action', async () => {
    H.getAllTeams.mockResolvedValue([])
    await renderPage()

    expect(screen.getByText('אין צוותים עדיין')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'עריכת צוותים' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הוספת צוות' })).toBeInTheDocument()
  })

  it('with zero teams, the create action opens the existing team form', async () => {
    H.getAllTeams.mockResolvedValue([])
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'הוספת צוות' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('הוספת צוות')
  })

  it('with teams, lists them, keeps the create action, and shows no empty message', async () => {
    H.getAllTeams.mockResolvedValue([
      {
        id: 7,
        name: 'צוות צפון',
        users: [{ id: 1, name: 'דנה' }],
        mngrs: [{ id: 2, name: 'יוסי' }],
        offices: [{ id: 3, name: 'רוני' }],
      },
    ])
    await renderPage()

    expect(screen.getByRole('heading', { name: 'צוות צפון' })).toBeInTheDocument()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText('יוסי')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הוספת צוות' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'עריכת צוות' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'מחיקת צוות' })).toBeInTheDocument()
    expect(screen.queryByText('אין צוותים עדיין')).not.toBeInTheDocument()
  })
})
