import axios from 'axios'
import { twMerge } from 'tailwind-merge'
import { convertToWebP } from '@/lib/funcs'
import Icon from '@/lib/Icon'
import { addFiles, getPresigned } from '../../actions/files'

export function getFileType(type: string) {
  const t = type?.includes('/') ? type.split('/').pop() : type
  if (
    type?.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    type?.includes('application/msword')
  )
    return 'word'
  if (
    type?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
    type?.includes('application/vnd.ms-excel')
  )
    return 'excel'
  if (
    type?.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation') ||
    type?.includes('application/vnd.ms-powerpoint')
  )
    return 'powerpoint'
  if (type?.includes('application/pdf')) return 'pdf'

  if (['docx', 'docm', 'doc'].includes(t)) return 'word'
  if (['xls', 'xlsx', 'xlsb', 'xlsm'].includes(t)) return 'excel'
  if (['pptx', 'pptm', 'ppt'].includes(t)) return 'powerpoint'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(t)) return 'image'
  return 'other'
}
export function formatIconFile(type: string) {
  const fileType = getFileType(type)
  const bgColors = {
    word: 'bg-blue-600',
    excel: 'bg-green-600',
    powerpoint: 'bg-orange-600',
    pdf: 'bg-red-600',
    image: 'bg-purple-600',
    other: 'bg-gray-600',
  }

  if (fileType === 'other') return <Icon name='file' className={`${bgColors[fileType]} size-4`} />
  return <Icon name={`file-${fileType}`} className={`${bgColors[fileType]} size-4`} />
}

function getTypeName(file: any) {
  if (typeof file === 'object' && file.url) {
    return {
      ...file,
      fileType: getFileType(file.type),
    }
  }
  return { type: 'other', name: 'לא ניתן להציג', url: '' }
}

export function FileDisplay({ files, onRemove = null, className = '', tooltipClass = '' }) {
  return (
    <div className={twMerge('text-sm mb-2', className)}>
      {files.map((file, i) => {
        file = getTypeName(file)
        return (
          <div key={i} className='grid grid-cols-[auto_1fr_auto] gap-2 group mb-1 items-center relative w-full'>
            {formatIconFile(file.type)}
            <a href={file.url} target='_blank' rel='noopener noreferrer' className='underline underline-offset-4 truncate'>
              {file.name}
            </a>
            {file.fileType === 'image' && <ImgTooltip src={file.url} className={tooltipClass} />}
            {onRemove && (
              <button
                type='button'
                onClick={() => onRemove(file)}
                className='opacity-0 group-hover:opacity-100  p-1 rounded-md hover:bg-red-50'
              >
                <Icon name='x' className='size-3 bg-gray-600' />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ImgTooltip({ src, className = '' }) {
  return (
    <img
      src={src}
      alt='Preview'
      className={twMerge(
        'rounded-lg shadow-3 h-50 hidden bg-white z-20 group-hover:block absolute bottom-full right-0 mb-4 anim-tooltip',
        className
      )}
      loading='lazy'
    />
  )
}

export async function uploadS3(e, folderPath, taskId, clientId) {
  try {
    const fileList = e.target.files
    if (fileList.length == 0) throw new Error('לא נבחרו קבצים')

    const uploadedFiles = Array.from(fileList) as any[]

    const convertedFiles: File[] = await Promise.all(
      uploadedFiles.map((f) => {
        if (f.size > 10000000) throw new Error('קובץ גדול מדי')
        return f.type.startsWith('image') ? convertToWebP(f) : f
      })
    )

    const metadat = convertedFiles.map((f) => ({ name: sanitizeName(f.name), type: f.type, size: f.size }))

    const presigned = await getPresigned({ metadat, folderPath })
    await Promise.all(presigned.map((p, i) => axios.put(p.url, convertedFiles[i], { headers: { 'Content-Type': p.type } })))
    return await addFiles({ presigned, taskId, clientId })
  } catch (error: any) {
    return { err: true, msg: error.message }
  }
}

export function ImgDisplay({ files, onRemove }) {
  return (
    <div className='flex'>
      {files.map((src, i) => (
        <div className='relative group' key={i}>
          <a href={src} target='_blank' rel='noopener noreferrer'>
            <img src={src} loading='lazy' alt='preview' className='rounded-lg shadow-1 h-20 w-full' />
          </a>

          <button
            type='button'
            onClick={() => onRemove(src)}
            className='opacity-0 group-hover:opacity-100 absolute top-1 left-1 bg-white rounded-full p-1'
          >
            <Icon name='x' className='size-3 bg-red-600' type='reg' />
          </button>
        </div>
      ))}
    </div>
  )
}

export function sanitizeName(name: string) {
  return name.replaceAll(/[^a-zA-Z0-9\u0590-\u05FF_-\s.]/g, '').replaceAll(' ', '_')
}
