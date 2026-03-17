'use client'
import { uploadSalesData } from '@/actions/uploadSales'
import { Btn } from '@/lib/btns/Btn'

export default function UploadSalesXL() {
  async function handleUpload() {
    await uploadSalesData()
  }
  return (
    <div>
      <Btn lbl='העלאה' onClick={handleUpload} />
    </div>
  )
}
