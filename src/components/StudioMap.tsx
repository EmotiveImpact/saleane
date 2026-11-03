import { MapPin } from 'lucide-react'
import { studioMap } from '../domain/maps'
import './moments.css'

/**
 * Stage 6: a map of where the studio is, on the guest's visit page. With no map service
 * connected it draws a quiet placeholder: soft lines that are not real streets, a pin, the address
 * and a line saying the map appears once a map service is connected. It never calls a map service.
 */
export function StudioMap({ address, name }: { address: string; name: string }) {
  const view = studioMap(address)
  if (!view) return null
  if (view.kind === 'map')
    return (
      <figure className="studio-map">
        <img src={view.src} alt={view.alt} loading="lazy" />
        <figcaption>{view.credit}</figcaption>
      </figure>
    )
  return (
    <figure className="studio-map studio-map-placeholder" aria-label={`Where ${name} is`}>
      <svg
        className="studio-map-lines"
        viewBox="0 0 320 140"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M-10 92 C 60 80, 110 104, 170 88 S 280 60, 330 70" />
        <path d="M-10 34 C 70 44, 150 22, 210 36 S 300 48, 330 40" />
        <path d="M86 -10 C 92 40, 78 90, 96 150" />
        <path d="M232 -10 C 222 50, 246 96, 236 150" />
        <path className="studio-map-lane" d="M-10 122 C 90 116, 190 132, 330 118" />
        <path className="studio-map-lane" d="M150 -10 C 158 30, 146 60, 160 150" />
      </svg>
      <span className="studio-map-pin" aria-hidden="true">
        <MapPin size={26} strokeWidth={1.75} />
      </span>
      <figcaption>
        <strong>{view.address}</strong>
        <small>{view.note}</small>
      </figcaption>
    </figure>
  )
}
