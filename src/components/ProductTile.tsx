import './productTile.css'

const tones = ['sage', 'blue', 'sand'] as const

/**
 * A product's initial on a soft tile, in place of a photograph: products have no pictures of
 * their own, and a stock photograph would show something the studio does not sell.
 */
export function ProductTile({
  id,
  name,
  size = 'regular',
}: {
  id: string
  name: string
  size?: 'regular' | 'small'
}) {
  const initial = name.match(/\p{L}|\p{N}/u)?.[0]?.toLocaleUpperCase() ?? '·'
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return (
    <span
      aria-hidden="true"
      className={`product-tile product-tile-${size} tone-${tones[hash % tones.length]}`}
    >
      {initial}
    </span>
  )
}
