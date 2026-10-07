import { MapPin } from 'lucide-react'
import '../guest-extras.css'

/** What a guest is told when their treatment needs a patch test. */
function patchTestNote(hours: number) {
  return `This treatment needs a quick patch test at least ${hours} hours before. If you have not had one with us recently, please call or pop in to arrange one.`
}

/**
 * The studio's "before you arrive" notes: one studio-wide (directions, parking, how long to
 * allow) and one for the booked service. Plain text written by the studio; nothing clinical.
 * Renders nothing when the studio has written neither.
 */
export function BeforeYouArrive({
  studioNote,
  serviceNote,
  patchTestHours,
}: {
  studioNote?: string
  serviceNote?: string
  /** V1.5: set when the treatment needs a patch test, to say how far ahead. */
  patchTestHours?: number
}) {
  const notes = [studioNote, serviceNote, patchTestHours ? patchTestNote(patchTestHours) : '']
    .map((note) => note?.trim() ?? '')
    .filter(Boolean)
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
