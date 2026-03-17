import { genId } from '@/lib/funcs'

export function createHiddenTable({ head, body, fdata }) {
  // Remove any existing wrapper to prevent duplicates if function is called multiple times
  const existingWrapper = document.getElementById('exportTableWrapper')
  if (existingWrapper) {
    existingWrapper.remove()
  }

  const wrapper = document.createElement('div')
  wrapper.id = 'exportTableWrapper'
  // Styles for the wrapper to ensure it's off-screen and sizes to content
  wrapper.style.position = 'absolute'
  wrapper.style.left = '-99999px' // Position off-screen
  wrapper.style.top = '-99999px'
  wrapper.style.zIndex = '-100' // Ensure it's behind everything
  wrapper.style.padding = '20px' // Padding around the content for capture
  wrapper.style.backgroundColor = 'white' // Ensure a consistent background for capture
  wrapper.style.display = 'inline-block' // CRITICAL: Makes wrapper size to its content's width

  const headerEl = document.createElement('div')
  headerEl.id = 'exportTableHeader'
  headerEl.className = 'flex items-end justify-between'
  wrapper.appendChild(headerEl)

  if (fdata.title) {
    const titleEl = document.createElement('h1')
    titleEl.className = 'text-3xl font-semibold mb-4'
    titleEl.textContent = fdata.title
    headerEl.appendChild(titleEl)
  }

  if (fdata.img) {
    const imgEl = document.createElement('img')
    imgEl.className = 'max-w-72 max-h-24 object-contain mb-4'
    imgEl.crossOrigin = 'anonymous'
    // const imageUrl = fdata.img
    const imageUrl = `${fdata.img}?v=${genId()}`

    imgEl.src = imageUrl
    headerEl.appendChild(imgEl)
  }

  const table = document.createElement('table')
  table.id = 'exportTable'

  table.className = 'w-full text-sm text-gray-500' // Base table classes
  table.style.width = 'auto' // Allow table to determine its own width
  table.style.minWidth = '100%' // Ensures table takes at least the width of its inline-block container
  table.style.fontSize = '10px' // Base font size for the table, adjust as needed for density

  const thead = document.createElement('thead')
  thead.className = 'text-xs bg-blue-50' // Table head classes

  const trHead = document.createElement('tr')
  head.forEach((text) => {
    const th = document.createElement('th')
    th.className = 'px-4 py-2'

    th.textContent = text
    trHead.appendChild(th)
  })
  thead.appendChild(trHead)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  body.forEach((row) => {
    const tr = document.createElement('tr')
    tr.className = 'px-4 py-2 border-b border-r bg-white' // Table row classes

    // tr.style.borderBottom = '1px solid #eeeeee' // Row separator
    row.forEach((text, cellIndex) => {
      const td = document.createElement('td')
      td.className = 'px-4 py-2 border-l text-black/90'
      td.textContent = String(text) // Ensure text is string
      if ((fdata.sum && body[body.length - 1] === row) || (typeof text === 'string' && text.includes('סה"כ'))) {
        td.style.fontWeight = 'bold'
        if (cellIndex === 0) tr.style.backgroundColor = '#f9f9f9' // Slightly different bg for sum row
      }
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  })
  table.appendChild(tbody)

  wrapper.appendChild(table)
  document.body.appendChild(wrapper)
}
