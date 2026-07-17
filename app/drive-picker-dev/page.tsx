import { notFound } from 'next/navigation'
import { isDrivePickerEnabled } from '@/lib/integrations/google/picker/pickerCore'
import DrivePickerButton from '@/components/clientPage/DrivePickerButton'

export default function DrivePickerDevPage() {
  if (!isDrivePickerEnabled()) notFound()

  return (
    <main className='mx-auto grid max-w-md gap-4 p-8'>
      <h1 className='text-lg font-bold'>Drive Picker — Phase 1 dev harness</h1>
      <p className='text-sm text-gray-600'>
        פותח את ה-Google Picker דרך GIS. חבר תחילה את Google Drive, ואז לחץ על הכפתור.
      </p>
      <DrivePickerButton />
    </main>
  )
}
