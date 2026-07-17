'use client'

import { useCallback, useState } from 'react'
import { getPickerClientConfig } from './pickerCore'
import type { PickedDriveFile } from './pickerCore'
import { loadGis, loadPickerApi } from './loadPickerScripts'
import { openDrivePicker, requestDriveAccessToken } from './pickerRuntime'

type DrivePickerStatus = 'idle' | 'loading' | 'open' | 'error' | 'unconfigured'

type OpenHandlers = {
  onPicked: (files: PickedDriveFile[]) => void
  onCancel?: () => void
}

export function useDrivePicker() {
  const [status, setStatus] = useState<DrivePickerStatus>('idle')

  const openPicker = useCallback(async (handlers: OpenHandlers) => {
    const config = getPickerClientConfig()
    if (!config) {
      setStatus('unconfigured')
      return
    }
    setStatus('loading')
    try {
      await Promise.all([loadGis(), loadPickerApi()])
      const token = await requestDriveAccessToken(config.clientId)
      openDrivePicker({
        token,
        config,
        onPicked: (files) => {
          setStatus('idle')
          handlers.onPicked(files)
        },
        onCancel: () => {
          setStatus('idle')
          handlers.onCancel?.()
        },
      })
      setStatus('open')
    } catch {
      setStatus('error')
    }
  }, [])

  return { status, openPicker }
}
