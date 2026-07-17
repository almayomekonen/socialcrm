import { describe, it, expect, afterEach } from 'vitest'
import {
  mapPickedFile,
  isDrivePickerEnabled,
  getPickerClientConfig,
  DRIVE_PICKER_SCOPE,
} from '@/lib/integrations/google/picker/pickerCore'

describe('pickerCore.mapPickedFile', () => {
  it('maps a full picker document', () => {
    expect(
      mapPickedFile({
        id: 'abc',
        name: 'Contract.pdf',
        mimeType: 'application/pdf',
        url: 'https://drive.google.com/file/d/abc/view',
      }),
    ).toEqual({
      driveFileId: 'abc',
      name: 'Contract.pdf',
      mimeType: 'application/pdf',
      webViewLink: 'https://drive.google.com/file/d/abc/view',
    })
  })

  it('defaults the mime type and yields null url when absent', () => {
    expect(mapPickedFile({ id: 'a', name: 'n' })).toEqual({
      driveFileId: 'a',
      name: 'n',
      mimeType: 'application/octet-stream',
      webViewLink: null,
    })
  })

  it('returns null when id or name is missing', () => {
    expect(mapPickedFile({ name: 'n' })).toBeNull()
    expect(mapPickedFile({ id: 'a' })).toBeNull()
    expect(mapPickedFile({})).toBeNull()
  })
})

describe('pickerCore flag + config', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('isDrivePickerEnabled is true only for the exact string "true"', () => {
    process.env.DRIVE_PICKER_ENABLED = 'true'
    expect(isDrivePickerEnabled()).toBe(true)
    process.env.DRIVE_PICKER_ENABLED = 'false'
    expect(isDrivePickerEnabled()).toBe(false)
    process.env.DRIVE_PICKER_ENABLED = '1'
    expect(isDrivePickerEnabled()).toBe(false)
    delete process.env.DRIVE_PICKER_ENABLED
    expect(isDrivePickerEnabled()).toBe(false)
  })

  it('getPickerClientConfig returns null when any value is missing', () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID
    process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY = 'k'
    process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID = '123'
    expect(getPickerClientConfig()).toBeNull()
  })

  it('getPickerClientConfig returns the full config when all present', () => {
    process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID = 'cid'
    process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY = 'key'
    process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID = '999'
    expect(getPickerClientConfig()).toEqual({ clientId: 'cid', apiKey: 'key', appId: '999' })
  })

  it('requests drive.readonly during phases 1-5 (flipped to drive.file at phase 6)', () => {
    expect(DRIVE_PICKER_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly')
  })
})
