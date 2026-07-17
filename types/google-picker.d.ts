export {}

declare global {
  interface Window {
    gapi?: GoogleApiLoader
    google?: GoogleNamespace
  }
}

interface GoogleApiLoader {
  load: (apiName: string, config: { callback: () => void; onerror?: () => void }) => void
}

interface GoogleNamespace {
  accounts?: {
    oauth2: {
      initTokenClient: (config: TokenClientConfig) => TokenClient
    }
  }
  picker?: GooglePickerApi
}

interface TokenClientConfig {
  client_id: string
  scope: string
  callback: (response: TokenResponse) => void
  error_callback?: (error: { type?: string; message?: string }) => void
}

interface TokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

interface GooglePickerApi {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (viewId?: unknown) => DocsView
  ViewId: { DOCS: unknown }
  Action: { PICKED: string; CANCEL: string }
}

interface DocsView {
  setIncludeFolders: (v: boolean) => DocsView
  setSelectFolderEnabled: (v: boolean) => DocsView
}

interface PickerBuilder {
  setAppId: (appId: string) => PickerBuilder
  setOAuthToken: (token: string) => PickerBuilder
  setDeveloperKey: (key: string) => PickerBuilder
  addView: (view: unknown) => PickerBuilder
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilder
  build: () => Picker
}

interface Picker {
  setVisible: (v: boolean) => void
}

interface PickerCallbackData {
  action?: string
  docs?: Array<Record<string, unknown>>
}
