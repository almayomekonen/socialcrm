// @vitest-environment jsdom
/**
 * The export button hands the server action the page's active filter — the
 * value the deals page renders with — and nothing else. Tables that pass their
 * rows directly (`data`) never call the action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }))
vi.mock('xlsx', () => ({
  utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => undefined },
  writeFile,
}))
vi.mock('jspdf', () => ({ default: vi.fn() }))
vi.mock('html2canvas-pro', () => ({ default: vi.fn() }))
vi.mock('@/components/files/FileUploader', () => ({ default: () => null }))
vi.mock('@/lib/i18n/I18nProvider', () => ({ useT: () => (k: string) => k }))

import ExportTable from '@/lib/table/export'
import { Provider } from '@/lib/hooksNEvents'

afterEach(() => {
  cleanup()
  writeFile.mockReset()
})

const clickExcel = () => fireEvent.click(screen.getByTitle('common.table.exportExcel'))

describe('ExportTable → deals export action', () => {
  it('passes the page’s active filter to the action', async () => {
    const filter = JSON.stringify({ dateRange: 'כל התאריכים', userIds: [3] })
    const action = vi.fn().mockResolvedValue([])
    render(
      <Provider props={{ exportFilter: filter }}>
        <ExportTable dataToFetch={action} columns={[]} />
      </Provider>,
    )
    clickExcel()
    await waitFor(() => expect(writeFile).toHaveBeenCalled())
    expect(action).toHaveBeenCalledWith(filter)
  })

  it('no active filter → null (the page defaults on the server)', async () => {
    const action = vi.fn().mockResolvedValue([])
    render(
      <Provider props={{ exportFilter: null }}>
        <ExportTable dataToFetch={action} columns={[]} />
      </Provider>,
    )
    clickExcel()
    await waitFor(() => expect(action).toHaveBeenCalledWith(null))
  })

  it('a table that passes its own rows never calls an action', async () => {
    const action = vi.fn()
    render(<ExportTable data={[]} dataToFetch={action} columns={[]} />)
    clickExcel()
    await waitFor(() => expect(writeFile).toHaveBeenCalled())
    expect(action).not.toHaveBeenCalled()
  })
})
