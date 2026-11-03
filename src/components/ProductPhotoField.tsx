import { useRef, useState } from 'react'
import { Camera, ImagePlus } from 'lucide-react'
import { useStore } from '../state/context'
import { ApiError, uploadImage } from '../state/api'
import { Button } from '../design'
import { ProductTile } from './ProductTile'
import { PhotoProblem, preparePhoto } from './productPhoto'

/**
 * Stage 2: a product's photo in the product form, from the device's pictures or, on a phone or
 * tablet, straight from its camera. The browser shrinks it first; SALEANE keeps it and the product
 * keeps its id once the form is saved. Replacing or removing a photo is saved the same way.
 */
export function ProductPhotoField({
  productId,
  name,
  imageId,
  disabled,
  onChange,
  onBusy,
}: {
  productId?: string
  name: string
  imageId: string
  disabled: boolean
  onChange: (imageId: string) => void
  onBusy: (busy: boolean) => void
}) {
  const { state } = useStore()
  const library = useRef<HTMLInputElement | null>(null)
  const camera = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  // A phone or tablet can take the photo there and then.
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

  async function chosen(input: HTMLInputElement) {
    const file = input.files?.[0]
    // The same photo can be chosen again after a problem.
    input.value = ''
    if (!file) return
    setError('')
    setStatus('Preparing the photo…')
    setBusy(true)
    onBusy(true)
    try {
      const prepared = await preparePhoto(file)
      setStatus('Adding the photo…')
      const { id } = await uploadImage(state.organisation.id, prepared.blob)
      onChange(id)
      setStatus('Photo ready. Save the product to keep it.')
    } catch (problem) {
      setStatus('')
      setError(
        problem instanceof PhotoProblem || problem instanceof ApiError
          ? problem.message
          : 'The photo could not be added. Try again.',
      )
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  const off = disabled || busy
  return (
    <div className="photo-field ops-wide">
      <ProductTile
        id={productId ?? 'new-product'}
        name={name.trim() || 'Product'}
        imageId={imageId || undefined}
        size="large"
      />
      <div className="photo-field-copy">
        <strong>Photo</strong>
        <small>
          Shown to your team wherever products are picked. A square photo on a plain background
          looks best; SALEANE makes it smaller before sending it.
        </small>
        <div className="photo-field-actions">
          <Button variant="secondary" disabled={off} onClick={() => library.current?.click()}>
            <ImagePlus size={16} aria-hidden="true" />{' '}
            {imageId ? 'Choose another photo' : 'Choose a photo'}
          </Button>
          {touch && (
            <Button variant="secondary" disabled={off} onClick={() => camera.current?.click()}>
              <Camera size={16} aria-hidden="true" /> Take a photo
            </Button>
          )}
          {imageId && (
            <Button
              variant="quiet"
              disabled={off}
              onClick={() => {
                onChange('')
                setStatus('Photo removed. Save the product to keep this.')
                setError('')
              }}
            >
              Remove the photo
            </Button>
          )}
        </div>
        <input
          ref={library}
          type="file"
          accept="image/*"
          hidden
          aria-label="Choose a photo"
          onChange={(event) => void chosen(event.currentTarget)}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="Take a photo"
          onChange={(event) => void chosen(event.currentTarget)}
        />
        {status && (
          <p className="photo-field-status" role="status">
            {status}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
