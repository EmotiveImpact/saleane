import { MapPin } from 'lucide-react'
import '../guest-extras.css'

/**
 * The studio's "before you arrive" notes: one studio-wide (directions, parking, how long to
 * allow) and one for the booked service. Plain text written by the studio; nothing clinical.
 * Renders nothing when the studio has written neither.
 */
export function BeforeYouArrive({
  studioNote,
  serviceNote,
}: {
  studioNote?: string
  serviceNote?: string
}) {
  const notes = [studioNote, serviceNote].map((note) => note?.trim() ?? '').filter(Boolean)
  if (!notes.length) return null
  return (
    <section className="before-arrive" aria-labelledby="before-arrive-heading">
      <h3 id="before-arrive-heading">
        <MapPin size={17} aria-hidden="true" />
        Before you arrive
      </h3>
      {notes.map((note, index) => (
        <p key={index}>{note}</p>
      ))}
    </section>
  )
}
