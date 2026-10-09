import { useId } from 'react'
import { ExternalLink, Mail, MapPin, Phone } from 'lucide-react'
import type { Region } from '../domain/model'
import { directionsLink, phoneLink } from '../domain/studioContact'
import './studioContact.css'

export type StudioContactDetails = {
  name: string
  /** The location the visit is at; left out when it reads the same as the studio's name. */
  locationName?: string
  address: string
  phone?: string
  email?: string
  region: Region
}

/**
 * Where the studio is and how to reach it: its name and address with directions (a maps search,
 * no embedded map), and its phone and email when it gave them. With neither, the guest is told
 * to reply to their confirmation email, so "contact the studio" never leads nowhere.
 */
export function StudioContact({
  studio,
  heading = 'Your studio',
}: {
  studio: StudioContactDetails
  heading?: string
}) {
  const id = useId()
  const name =
    studio.locationName && studio.locationName !== studio.name
      ? `${studio.name} · ${studio.locationName}`
      : studio.name
  return (
    <section className="studio-contact" aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      <div className="studio-contact-row">
        <MapPin size={18} aria-hidden="true" />
        <p>
          <strong>{name}</strong>
          {studio.address && <span>{studio.address}</span>}
          {studio.address && (
            <a href={directionsLink(studio.address)} target="_blank" rel="noopener noreferrer">
              Directions <ExternalLink size={14} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </p>
      </div>
      {studio.phone || studio.email ? (
        <ul className="studio-contact-ways" aria-label={`Ways to reach ${studio.name}`}>
          {studio.phone && (
            <li>
              <a href={phoneLink(studio.phone, studio.region)}>
                <Phone size={17} aria-hidden="true" />
                <span>
                  <small>Call</small> <span className="studio-contact-value">{studio.phone}</span>
                </span>
              </a>
            </li>
          )}
          {studio.email && (
            <li>
              <a href={`mailto:${studio.email}`}>
                <Mail size={17} aria-hidden="true" />
                <span>
                  <small>Email</small> <span className="studio-contact-value">{studio.email}</span>
                </span>
              </a>
            </li>
          )}
        </ul>
      ) : (
        <p className="studio-contact-none">To get in touch, reply to your confirmation email.</p>
      )}
    </section>
  )
}
