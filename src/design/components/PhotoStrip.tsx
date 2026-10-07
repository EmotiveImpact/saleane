/** A wide decorative photograph between a page heading and its work. */
export function PhotoStrip({ src, position = 'center' }: { src: string; position?: string }) {
  return (
    <div
      className="photo-strip"
      aria-hidden="true"
      style={{ backgroundImage: `url(${src})`, backgroundPosition: position }}
    />
  )
}
