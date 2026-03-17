import { useEffect, useState } from 'react'
import { getUserImgs } from '../../actions/files'
import { useUser } from '@/lib/hooksNEvents'
import { Btn } from '@/lib/btns/Btn'

export default function Glry({ onSelect }) {
  const user = useUser()

  const [imgs, setImgs] = useState([])
  useEffect(() => {
    getUserImgs(user.id).then((imgs) => setImgs(imgs))
  }, [])

  function onInrSelect(img) {
    onSelect(img)
    document.getElementById('galleryPop')?.hidePopover()
  }

  if (!imgs?.length) return null

  return (
    <>
      <Btn variant='outline' type='button' lbl='בחירה מגלריה' popoverTarget='galleryPop' icon='images' />
      <div id='galleryPop' popover='auto' className='pop'>
        <div className='grid grid-cols-6 gap-4'>
          {imgs.map((img) => (
            <img
              key={img.id}
              src={img.url}
              alt='img'
              loading='lazy'
              className='size-22 cursor-pointer shadow-1 rounded-md'
              onClick={() => onInrSelect(img)}
            />
          ))}
        </div>
      </div>
    </>
  )
}
