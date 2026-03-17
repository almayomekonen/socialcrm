'use client'
import * as xlsx from 'xlsx'
import { Checkbox, Input } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import jsPDF from 'jspdf'
import { formatDate, formatDateTime } from '@/lib/dates'
import { clone, formatCurrency, formatPrecent, formatRoundCurrency } from '@/lib/funcs'
import { getNestedValue } from '@/lib/table/funcs'
import { ConfigT } from '@/lib/table'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { createHiddenTable } from '@/lib/table/export/HiddenTable'
import html2canvas from 'html2canvas-pro'
import { useProps } from '@/lib/hooksNEvents'
import FileUploader from '@/components/files/FileUploader'
import { useState } from 'react'
import { SubmitButton } from '@/lib/btns/SubmitBtn'

type Props = {
  data?: any
  columns: any
  dataToFetch?: any
}

export default function ExportTable({ data, dataToFetch, columns }: Props) {
  const [img, setImg] = useState(null)
  let sql = null
  try {
    const { sqlExport } = useProps()
    sql = sqlExport
  } catch (error) {}

  async function getData() {
    if (data) return data
    return await dataToFetch(sql)
  }

  async function onSubmit(e) {
    const fdata = getFormData2(e)
    fdata.img = img

    console.log('fdata: ', fdata)

    const tblData = await getData()

    const sliceBy = 700
    for (let i = 0; i < tblData.length; i += sliceBy) {
      const slicedData = tblData.slice(i, i + sliceBy)
      await exportToPDF(slicedData, columns, { ...fdata, index: i })
    }
  }

  async function exportXL() {
    const { arr, head } = formatDataXL(await getData(), columns)

    const xl_data = [head, ...arr]
    const wb = xlsx.utils.book_new()
    const ws = xlsx.utils.aoa_to_sheet(xl_data, { dateNF: 'DD/MM/YYYY' })
    xlsx.utils.book_append_sheet(wb, ws, 'sheet1')

    wb.Workbook = {
      Views: [{ RTL: true }],
    }
    xlsx.writeFile(wb, 'sales.xlsx')
  }

  return (
    <>
      <div className='flex gap-2'>
        <Btn
          popoverTarget='exportPdfForm'
          icon='file-pdf'
          variant='outline'
          size='icon'
          iconClassName='bg-red-700'
          title='ייצוא טבלה ל PDF'
        />
        <Btn
          onClick={exportXL}
          icon='file-excel'
          variant='outline'
          size='icon'
          iconClassName='bg-green-700'
          title='ייצוא טבלה ל Excel'
        />
      </div>

      <div id='exportPdfForm' popover='manual' className='pop max-w-96'>
        <button className='absolute top-2 left-2 z-10' popoverTarget='exportPdfForm'>
          <Icon name='circle-xmark' className='bg-red-700' />
        </button>
        <form className='grid gap-4' onSubmit={onSubmit}>
          <Input lbl='כותרת' name='title' required={false} />
          <FileUploader
            onFilesChange={(file) => setImg(file[0]?.url)}
            folder='display'
            single
            name='img'
            type='image'
            tooltipClass='top-full mt-4 w-full'
            title='העלאת תמונה'
          />
          <Checkbox lbl='הוספת שורת סה"כ בסוף הטבלה' name='sum' />
          <SubmitButton lbl='יצירת מסמך PDF' icon='download' />
        </form>
      </div>
    </>
  )
}

const exportToPDF = async (data, columns, fdata) => {
  const { arr, head } = formatData(data, columns, fdata)

  createHiddenTable({ head, body: arr, fdata })

  const tableWrapper = document.getElementById('exportTableWrapper')
  if (!tableWrapper) return console.error('Export table wrapper not found')

  try {
    const scale = 2
    const canvas = await html2canvas(tableWrapper, {
      scale,
      useCORS: true,
      // allowTaint: true,
    })
    const imgData = canvas.toDataURL('image/jpeg')
    // const imgData = canvas.toDataURL('image/webp')

    // chat removed the / scale
    const canvasWidthPx = canvas.width / scale
    const canvasHeightPx = canvas.height / scale

    if (canvasWidthPx === 0 || canvasHeightPx === 0) {
      console.error('Canvas dimensions are zero, cannot export PDF.')
      return
    }

    const pageMargin = 20 // Points for margin on each side of the PDF page

    // This factor converts CSS pixels from canvas to PDF points.
    // 0.75 is a common starting point (e.g., for a 96 DPI screen to 72 DPI PDF).
    // Adjust this factor if images generally appear too large or too small.
    const pixelToPointScaleFactor = 0.75
    let pdfImageWidthPt = canvasWidthPx * pixelToPointScaleFactor

    const MIN_PDF_IMAGE_WIDTH_PT = 400
    const MAX_PDF_IMAGE_WIDTH_PT = 1100

    pdfImageWidthPt = Math.min(MAX_PDF_IMAGE_WIDTH_PT, Math.max(MIN_PDF_IMAGE_WIDTH_PT, pdfImageWidthPt))

    // Calculate PDF image height maintaining aspect ratio
    const aspectRatio = canvasHeightPx / canvasWidthPx
    const pdfImageHeightPt = pdfImageWidthPt * aspectRatio

    // Determine PDF page dimensions and orientation
    const pdfPageWidthPt = pdfImageWidthPt + pageMargin * 2
    const pdfPageHeightPt = pdfImageHeightPt + pageMargin * 2

    const orientation = pdfPageWidthPt > pdfPageHeightPt ? 'landscape' : 'portrait'

    const pdf = new jsPDF({
      orientation: orientation,
      unit: 'pt',
      format: [pdfPageWidthPt, pdfPageHeightPt], // jsPDF handles orientation with these dimensions
      compress: true,
    })

    pdf.addImage(imgData, 'JPEG', pageMargin, pageMargin, pdfImageWidthPt, pdfImageHeightPt)
    pdf.save('table.pdf')
  } catch (error) {
    console.error('Error exporting to PDF:', error)
  } finally {
    tableWrapper.remove()
  }
}

function formatDataXL(data, columns) {
  const cols = columns.filter((col) => !col.noShow)
  const head = cols.map((col) => col.label)

  function getValXL(item: any, col: ConfigT['columns'][number]) {
    const value = getNestedValue(item, col.key)
    if (typeof value == 'boolean') return formatBoolean(value)
    if (!value && col.format == 'formatCurrency') return 0

    return value
  }

  const arr = data.map((item, i) => {
    return cols.map((col) => getValXL(item, col))
  })

  return { arr, head }
}

function formatData(data, columns, fdata) {
  const cols = columns.filter((col) => !col.noShow)
  const head = ['#', ...cols.map((col) => col.label)]

  const firstColName = cols[0].key

  const tmp_data = fdata?.sum ? addSumRow(data, firstColName) : data

  const arr = tmp_data.map((item, i) => [i + 1 + fdata?.index + '#', ...cols.map((col) => getVal(item, col))])

  return { arr, head }
}

function getVal(item: any, col: ConfigT['columns'][number]) {
  const value = getNestedValue(item, col.key)
  if (typeof value == 'boolean') return formatBoolean(value)
  if (col.format && funcs[col.format]) return funcs[col.format](value, item)
  if (!value) return ''
  return value
}

const funcs = {
  formatDate,
  formatCurrency,
  formatDateTime,
  formatRoundCurrency,
  formatPrecent,
}

function addSumRow(data, firstColName) {
  const tmp_data = clone(data)

  const sums = tmp_data.reduce((acc, obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'number') {
        acc[key] = (acc[key] || 0) + obj[key]
      }
    }
    return acc
  }, {})

  tmp_data.push({ id: 'sum', [firstColName]: 'סה"כ', ...sums })

  return tmp_data
}

function formatBoolean(value) {
  return value ? 'כן' : 'לא'
}
