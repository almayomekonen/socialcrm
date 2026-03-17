// ------------------------------
// #region Format Numbers
// ------------------------------

import { toast } from './toast'

export function formatCurrency(num: number) {
  if (!num) num = 0
  if (isNaN(num)) return num

  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num)
}

export function formatRoundCurrency(num: number) {
  if (!num) num = 0
  if (isNaN(num)) return num

  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(num)
}

export function formatPrecent(num: number) {
  if (!num) return '0%'
  if (isNaN(num)) return num

  return Math.round(num) + '%'
}

export function formatShortCurrency(num: number) {
  if (!num) num = 0
  if (isNaN(num)) return num

  const res = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(num)

  return res + ' ₪'
}

// #endregion

export function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function genId(): number {
  return Math.floor(Math.random() * 999999)
}

export const clone = (el: any) => {
  return JSON.parse(JSON.stringify(el))
}

export const inRng = (num: number, min: number, max: number): boolean => {
  return num >= min && num <= max
}

export function removeItem(arr: any[], id: any): any[] {
  const tmpArr = clone(arr)

  const index = tmpArr.findIndex((a) => a.id === id)
  if (index > -1) tmpArr.splice(index, 1)

  return tmpArr
}

export const omit = (obj: any, keys: string[]) => keys.forEach((key) => delete obj[key])

export function groupBy(xs, field) {
  return Object.values(xs.reduce((r, v) => ((r[v[field]] = r[v[field]] || []).push(v), r), {}))
}

export function isIdNumValid(id: string | number): boolean {
  id = id?.toString()?.trim()
  if (!id || id.length > 9 || isNaN(Number(id)) || Number(id) <= 0) return false
  id = id.padStart(9, '0')

  let sum = 0
  for (let i = 0; i < 9; i++) {
    let digit = Number(id[i])
    let weight = i % 2 === 0 ? 1 : 2
    let product = digit * weight
    sum += product > 9 ? product - 9 : product
  }

  return sum % 10 === 0
}

export function fuzzySearch(input, target) {
  const pattern = input.split('').join('.*')
  const regex = new RegExp(pattern)
  return regex.test(target)
}

// ------------------------------

export function convertToWebP(file: File, maxWidth = 1024, maxHeight = 1024): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = function (e) {
      const img = new Image()
      img.src = e.target?.result as string

      img.onload = function () {
        let width = img.width
        let height = img.height

        // Resize the image if it's too large
        if (width > maxWidth || height > maxHeight) {
          const aspectRatio = width / height

          if (width > height) {
            width = maxWidth
            height = Math.round(maxWidth / aspectRatio)
          } else {
            height = maxHeight
            width = Math.round(maxHeight * aspectRatio)
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          return reject(new Error('Failed to get canvas context'))
        }
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('Canvas to Blob conversion failed'))
            }
            const newName = file.name.substring(0, file.name.lastIndexOf('.')) + '.webp'
            const newFile = new File([blob], newName, { type: 'image/webp' })
            resolve(newFile)
          },
          'image/webp',
          0.9, // image quality
        )
      }

      img.onerror = function () {
        reject('Failed to load the image.')
      }
    }

    reader.onerror = function () {
      reject('Failed to read the file.')
    }

    reader.readAsDataURL(file)
  })
}

export function getSearchParams(): { str: string; params: URLSearchParams | null } {
  if (typeof window === 'undefined') return { str: '', params: null }

  const str = window.location.search.slice(1)
  return { str, params: new URLSearchParams(str) }
}

export function toMB(size: number) {
  return (size / (1024 * 1024)).toFixed(2)
}

export function genToken() {
  const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

  return token
}

export function roundOrZero(num: number) {
  const res = Math.round(num)
  return res < 0 ? 0 : res
}

export function round(num: number) {
  return Math.round(num)
}

export function omitOffice(users: any[]) {
  return users.filter((user) => user.role !== 'OFFICE')
}

export function omitOfficeExt(users: any[]) {
  return users.filter((user) => user.role !== 'OFFICE' && user.role !== 'EXT')
}

export function setPosAndPop(e, id, onClick = null) {
  onClick?.()

  const pop = document.getElementById(id)
  pop.style.left = `${e.clientX}px`
  pop.style.top = `${e.clientY}px`
  pop.showPopover()
}

export const copyToClipboardToast = (text) => {
  navigator.clipboard.writeText(text)
  toast('success', `${text} הועתק ללוח`)
}
export const copyToClipboard = (text) => {
  navigator.clipboard.writeText(text)
}

export function formatPrcnt(num) {
  if (!num) return null
  return `${num}%`
}

export const sumObjValues = (obj: Record<string, { name: string; value: number }[]>) =>
  Object.values(obj)
    .flat()
    .reduce((acc, v) => acc + v.value, 0)

export function delDups<T>(arr: T[]): T[] {
  if (!Array.isArray(arr) || arr.length === 0) {
    return []
  }

  const firstItem = arr[0]
  if (typeof firstItem === 'object' && firstItem !== null) {
    return [...new Map(arr.map((item) => [JSON.stringify(item), item])).values()]
  }

  return [...new Set(arr)]
}

export async function api(func: (...args: any[]) => Promise<any>, data: any | any[], msg?: string, errMsg?: string) {
  try {
    toast('loading')
    const res = Array.isArray(data) ? await func(...data) : await func(data)
    toast('success', msg)
    return res
  } catch (err: any) {
    toast('error', errMsg)
    return { msg: errMsg || err.message, err: true }
  }
}
