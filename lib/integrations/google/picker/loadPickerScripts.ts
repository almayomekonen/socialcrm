'use client'

let gisPromise: Promise<void> | null = null
let pickerPromise: Promise<void> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error(`script_load_failed: ${src}`)))
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve()
    })
    script.addEventListener('error', () => reject(new Error(`script_load_failed: ${src}`)))
    document.head.appendChild(script)
  })
}

export function loadGis(): Promise<void> {
  if (!gisPromise) {
    gisPromise = injectScript('https://accounts.google.com/gsi/client').then(() => {
      if (!window.google?.accounts?.oauth2) throw new Error('gis_unavailable')
    })
  }
  return gisPromise
}

export function loadPickerApi(): Promise<void> {
  if (!pickerPromise) {
    pickerPromise = injectScript('https://apis.google.com/js/api.js').then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (!window.gapi) return reject(new Error('gapi_unavailable'))
          window.gapi.load('picker', {
            callback: () => resolve(),
            onerror: () => reject(new Error('picker_load_failed')),
          })
        }),
    )
  }
  return pickerPromise
}
