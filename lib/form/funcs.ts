export function onlyVals(obj: any) {
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => v))
}

export function onlyValObj(obj: any) {
  const filter = {}
  for (const key in obj) {
    if (obj[key]) filter[key] = obj[key]
  }
  return filter
}

export function onlyValsAction(obj: any) {
  const filter = {}
  for (const key in obj) {
    if (obj[key] && !key.startsWith('$')) filter[key] = obj[key]
  }
  return filter
}

export function getObjFormData(e: Event | HTMLFormElement): Record<string, any> {
  e.preventDefault()
  const form = e.target as HTMLFormElement
  const formData = new FormData(form)
  const result: Record<string, any> = {}

  const arraySyntaxRegex = /^([\w\u0590-\u05FF]+)\[(\d+)\]\.([\w\u0590-\u05FF ]+)$/
  const objectSyntaxRegex = /^([\w\u0590-\u05FF]+)\.([\w\u0590-\u05FF]+)$/

  for (const [key, value] of formData.entries()) {
    if (value === '') continue
    const arrayMatch = key.match(arraySyntaxRegex)
    const objectMatch = key.match(objectSyntaxRegex)

    if (arrayMatch) {
      // It's an array item like "prdcts[0].company"
      const [, arrayName, indexStr, propName] = arrayMatch
      const index = parseInt(indexStr, 10)

      if (!result[arrayName]) {
        result[arrayName] = []
      }
      if (!result[arrayName][index]) {
        result[arrayName][index] = {}
      }
      result[arrayName][index][propName] = value
    } else if (objectMatch) {
      // It's a nested object like "client.firstName"
      const [, objectName, propName] = objectMatch

      if (!result[objectName]) {
        result[objectName] = {}
      }
      result[objectName][propName] = value
    } else {
      // It's a simple key-value or a multi-value (checkbox)
      if (result.hasOwnProperty(key)) {
        if (!Array.isArray(result[key])) {
          result[key] = [result[key]]
        }
        result[key].push(value)
      } else {
        result[key] = value
      }
    }
  }

  // Optional: Clean up any sparse arrays if needed
  for (const key in result) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].filter((item) => item !== undefined && item !== null)
    }
  }

  return result
}

export const getServerMultiFormData = (fd) => {
  const data = {}
  fd.forEach((value, key) => {
    if (!value || key.startsWith('$')) return
    if (key.endsWith('[]')) {
      const arrayKey = key.slice(0, -2)
      if (!data[arrayKey]) data[arrayKey] = []
      data[arrayKey].push(value)
    } else data[key] = value
  })

  return data
}

export const getServerFormData = (formData) => {
  const rawData = Object.fromEntries(formData)
  const data = Object.fromEntries(Object.entries(rawData).filter(([key]) => !key.startsWith('$'))) as any

  return onlyVals(data)
}

// --------------------------------------------------
// ------------  getStructuredFormData  ------------
// --------------------------------------------------

function getNestedPrefix(element, formElement) {
  const prefixes: string[] = []
  let currentParent = element.parentElement

  while (currentParent && currentParent !== formElement.parentElement) {
    if (currentParent.dataset.prefix) prefixes.push(currentParent.dataset.prefix)
    if (currentParent === formElement) break
    currentParent = currentParent.parentElement
  }

  return prefixes.reverse().join('.')
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.')
  const lastKey = keys.pop()
  let current = obj
  for (const key of keys) {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key]
  }
  current[lastKey] = value
}

function tryParseJSON(value) {
  if (typeof value !== 'string' || !value) return value
  const trimmedValue = value.trim()
  if (
    (trimmedValue.startsWith('{') && trimmedValue.endsWith('}')) ||
    (trimmedValue.startsWith('[') && trimmedValue.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmedValue)
    } catch (e) {}
  }
  return value
}

export function getMultiObjFormData(e, withNulls = false) {
  e.preventDefault()
  const formElement = e.target
  const fd = new FormData(formElement)
  const data = {}

  fd.forEach((originalValue, key) => {
    const value = tryParseJSON(originalValue)
    if (!value && !withNulls) return

    const element = formElement.elements[key]
    const sourceElement = element?.nodeName === 'INPUT' ? element : element?.[0]

    const prefixString = getNestedPrefix(sourceElement, formElement)

    const finalKey = key.replace(/\[\]$/, '')
    const pathSegments: string[] = []
    if (prefixString) {
      pathSegments.push(prefixString)
    }
    pathSegments.push(finalKey)
    const finalPath = pathSegments.join('.')

    if (key.endsWith('[]')) {
      const keys = finalPath.split('.')
      const arrayKey = keys.pop() as string
      let current = data
      for (const k of keys) {
        if (!current[k] || typeof current[k] !== 'object') current[k] = {}
        current = current[k]
      }
      if (!current[arrayKey]) current[arrayKey] = []
      current[arrayKey].push(value)
    } else {
      setNestedValue(data, finalPath, value)
    }
  })

  return data
}

export const getFormData = (e: Event, withNulls: boolean = false) => {
  e.preventDefault()
  const form = e.target as HTMLFormElement
  const data = Object.fromEntries(new FormData(form) as any)

  return withNulls ? data : onlyVals(data)
}

export function getMultiFormData(e, withNulls: boolean = false) {
  e.preventDefault()
  const fd = new FormData(e.target)

  const data = {}
  fd.forEach((value, key) => {
    if (key.endsWith('[]')) {
      const arrayKey = key.slice(0, -2)
      if (!data[arrayKey]) data[arrayKey] = []
      value ? data[arrayKey].push(value) : (data[arrayKey] = [])
    } else if (value || withNulls) data[key] = value
  })

  return data
}

export function getFormData2(e) {
  e.preventDefault()
  const form = e.target as HTMLFormElement

  const fd = new FormData(form) as any
  const data = {} as any
  for (const [key, value] of fd.entries()) {
    //address.city
    if (key.includes('.')) {
      const keys = key.split('.')
      const lastKey = keys.pop()!
      let current = data

      for (const k of keys) {
        if (!current[k] || typeof current[k] !== 'object') {
          current[k] = {}
        }
        current = current[k]
      }

      if (lastKey.endsWith('[,]')) {
        const arrayKey = lastKey.slice(0, -3)
        current[arrayKey] = value ? value.split(',') : []
        continue
      }

      if (lastKey.endsWith('[]')) {
        const arrayKey = lastKey.slice(0, -2)
        if (!current[arrayKey]) current[arrayKey] = []
        value ? current[arrayKey].push(value) : (current[arrayKey] = [])
        continue
      }

      if (value === 'on') {
        current[lastKey] = true
        continue
      }

      if (value == '') {
        current[lastKey] = null
        continue
      }

      current[lastKey] = value
      continue
    }

    // MultiSelectsearch
    if (key.endsWith('[,]')) {
      data[key.slice(0, -3)] = value ? value.split(',') : []
      continue
    }

    if (key.endsWith('[]')) {
      const arrayKey = key.slice(0, -2)
      if (!data[arrayKey]) data[arrayKey] = []
      value ? data[arrayKey].push(value) : (data[arrayKey] = [])
      continue
    }

    if (value === 'on') {
      data[key] = true
      continue
    }

    if (value == '') {
      data[key] = null
      continue
    }

    data[key] = value
  }

  return data
}
