'use client'

import { DRIVE_PICKER_SCOPE, mapPickedFile } from './pickerCore'
import type { PickedDriveFile, PickerClientConfig } from './pickerCore'

export function requestDriveAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2
    if (!oauth2) return reject(new Error('gis_unavailable'))
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_PICKER_SCOPE,
      callback: (response) => {
        if (response.access_token) resolve(response.access_token)
        else reject(new Error(response.error || 'token_request_failed'))
      },
      error_callback: (error) => reject(new Error(error.type || 'token_request_error')),
    })
    tokenClient.requestAccessToken({ prompt: '' })
  })
}

export function openDrivePicker(args: {
  token: string
  config: PickerClientConfig
  onPicked: (files: PickedDriveFile[]) => void
  onCancel?: () => void
}): void {
  const picker = window.google?.picker
  if (!picker) throw new Error('picker_unavailable')

  const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false)

  const built = new picker.PickerBuilder()
    .setAppId(args.config.appId)
    .setOAuthToken(args.token)
    .setDeveloperKey(args.config.apiKey)
    .addView(view)
    .setCallback((data) => {
      if (data.action === picker.Action.PICKED) {
        const files = (data.docs ?? []).map((doc) => mapPickedFile(doc)).filter((file): file is PickedDriveFile => file !== null)
        args.onPicked(files)
      } else if (data.action === picker.Action.CANCEL) {
        args.onCancel?.()
      }
    })
    .build()

  built.setVisible(true)
}
