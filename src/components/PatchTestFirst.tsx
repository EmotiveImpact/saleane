import { useId } from 'react'
import type { MouseEvent } from 'react'
import { ArrowRight, Mail, MapPin, Phone } from 'lucide-react'
import type { Region } from '../domain/model'
import { directionsLink, phoneLink } from '../domain/studioContact'

/**
 * Stage 3: on the booking page, in place of "Choose a time", when the studio books a treatment
 * only for guests with a patch test. Every guest reads the same words, since the page never knows
 * who they are: that a patch test comes first, and how to get one, by booking the studio's patch
 * test here or by calling or emailing, or finding the studio when it gave neither. Nothing about
 * the guest or any record is shown.
 */
export function PatchTestFirst({
  treatment,
  hours,
  studio,
  test,
}: {
  treatment: string
  hours: number
  studio: { name: string; phone?: string; email?: string; address?: string; region: Region }
  /** The studio's patch test, when a guest can book it on this page. */
  test?: { href: string; onChoose: () => void }
}) {
  const id = useId()
  // How this guest can get in touch, in the words of the buttons below.
  const reach =
    studio.phone && studio.email
      ? 'call or email'
      : studio.phone
        ? 'call'
        : studio.email
          ? 'email'
          : 'pop in'
  // With neither a phone nor an email, the way to the studio.
  const visit = reach === 'pop in' && studio.address ? studio.address : ''
  function choose(event: MouseEvent<HTMLAnchorElement>) {
    // A new tab or window opens the link as it is.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    test?.onChoose()
  }
  return (
    <section className="booking-patch-first" aria-labelledby={id}>
      <h3 id={id}>A patch test comes first</h3>
      <p>
        {treatment} needs a quick patch test at least {hours} hours before your visit, so{' '}
        {studio.name} books it with you rather than online.
      </p>
      <p>
        {test
          ? `Book your patch test here. If you have had one with us recently, ${reach} to book.`
          : `${reach[0].toUpperCase()}${reach.slice(1)} to arrange your patch test, or to book if you have had one with us recently.`}
        {visit && ` You will find us at ${visit}.`}
      </p>
      <div className="booking-patch-actions">
        {test && (
          <a className="button button-primary" href={test.href} onClick={choose}>
            Book a patch test <ArrowRight size={17} aria-hidden="true" />
          </a>
        )}
        {studio.phone && (
          <a
            className={`button ${test ? 'button-secondary' : 'button-primary'}`}
            href={phoneLink(studio.phone, studio.region)}
          >
            <Phone size={16} aria-hidden="true" /> Call {studio.phone}
          </a>
        )}
        {studio.email && (
          <a
            className={`button ${test || studio.phone ? 'button-secondary' : 'button-primary'}`}
            href={`mailto:${studio.email}`}
          >
            <Mail size={16} aria-hidden="true" /> Email us
          </a>
        )}
        {visit && (
          <a
            className={`button ${test ? 'button-secondary' : 'button-primary'}`}
            href={directionsLink(visit)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin size={16} aria-hidden="true" /> Directions
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </section>
  )
}
