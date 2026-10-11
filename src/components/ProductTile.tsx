import { useState } from 'react'
import { useStore } from '../state/context'
import { imageUrl } from '../state/api'
import { studioRole } from '../domain/operations'
import { useImageSource } from './productPhoto'
import './productTile.css'

const tones = ['sage', 'blue', 'sand'] as const

/**
 * A product's photo on a soft square tile, or, until it has one, its initial on a tile of its own
 * colour. Stage 2: a studio adds its own product photos; a stock photograph would show something
 * the studio does not sell, so a product without one keeps its letter. A photo that cannot load
 * falls back to the letter too.
 */
export function ProductTile({
  id,
  name,
  imageId,
  size = 'regular',
}: {
  id: string
  name: string
  imageId?: string
  size?: 'regular' | 'small' | 'large'
}) {
  const { state, mode, role } = useStore()
  // Photos are served to the studio's own team; anyone else keeps the letter without asking.
  const source = useImageSource(
    imageId && mode === 'server' && studioRole(role)
      ? imageUrl(state.organisation.id, imageId)
      : undefined,
  )
  const [broken, setBroken] = useState('')
  const initial = name.match(/\p{L}|\p{N}/u)?.[0]?.toLocaleUpperCase() ?? '·'
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const tone = tones[hash % tones.length]
  if (source && broken !== source)
    return (
      <span
        aria-hidden="true"
        className={`product-tile product-tile-${size} product-tile-photo tone-${tone}`}
        data-initial={initial}
      >
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(source)}
        />
      </span>
    )
  return (
    <span aria-hidden="true" className={`product-tile product-tile-${size} tone-${tone}`}>
      {initial}
    </span>
  )
}
