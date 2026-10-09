import { useState } from 'react'
import { leads } from '../domain/operations'
import { Share2 } from 'lucide-react'
import { useStore } from '../state/context'
import { channelLink } from '../domain/bookingChannel'
import type { BookingChannel } from '../domain/model'
import { Button } from '../design'
import { hasLocations, places } from '../domain/locations'
import '../guest-extras.css'

type ShareLink = {
  channel?: BookingChannel
  label: string
  guidance: string
  id: string
  location?: string
}
const links: Omit<ShareLink, 'id'>[] = [
  {
    label: 'Your booking page',
    guidance: 'For your website, emails and anywhere else you share it.',
  },
  {
    channel: 'google',
    label: 'For Google',
    guidance:
      'In your Google Business Profile, add this as your appointment link so guests can book from Search and Maps.',
  },
  {
    channel: 'instagram',
    label: 'For Instagram',
    guidance: 'Put this in your Instagram bio, or add it as a link on your profile.',
  },
]

/**
 * Manage studio: the public booking address, ready to copy, with variants for Google and
 * Instagram. A guest who books through one of them is marked with where they came from. Nothing
 * here connects to Google or Instagram; the owner pastes the link themselves.
 */
export function ShareBookingPage() {
  const { mode, slug, role, state } = useStore()
  const [copied, setCopied] = useState('')
  if (!leads(role)) return null
  const base =
    mode === 'server' && slug
      ? `${window.location.origin}/book/${encodeURIComponent(slug)}`
      : `${window.location.origin}/booking`

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
    } catch {
      // Without clipboard access, select the text so the owner can copy it by hand.
      const field = document.getElementById(id) as HTMLInputElement | null
      field?.select()
      setCopied('')
    }
  }

  return (
    <section className="surface ops-panel" aria-labelledby="share-booking-heading">
      <header>
        <div>
          <h2 id="share-booking-heading">Share your booking page</h2>
          <p>
            Guests book here directly. The Google and Instagram links show you where a booking came
            from.
          </p>
        </div>
        <Share2 size={21} />
      </header>
      {mode !== 'server' && (
        <p className="ops-help">
          This is the browser demo, so the link opens the sample booking page in this browser only.
        </p>
      )}
      <div className="share-links">
        {[
          ...links.map((link) => ({ ...link, id: `share-link-${link.channel ?? 'direct'}` })),
          // V2: a link for each location opens the booking page with that location chosen.
          ...(hasLocations(state) ? places(state) : []).map((place) => ({
            label: `For ${place.name}`,
            guidance: `Opens your booking page with ${place.name} already chosen.`,
            id: `share-link-location-${place.id}`,
            location: place.id,
          })),
        ].map((link: ShareLink) => {
          const { channel, label, guidance, id, location } = link
          const url = location
            ? `${base}?location=${encodeURIComponent(location)}`
            : channelLink(base, channel)
          return (
            <div className="share-link" key={id}>
              <label htmlFor={id}>{label}</label>
              <div className="share-link-row">
                <input id={id} readOnly value={url} onFocus={(e) => e.target.select()} />
                <Button variant="secondary" onClick={() => void copy(url, id)}>
                  {copied === id ? 'Copied' : 'Copy'}
                  <span className="sr-only"> {label.toLowerCase()} link</span>
                </Button>
              </div>
              <small>{guidance}</small>
            </div>
          )
        })}
      </div>
      <p className="ops-help">
        SALEANE does not connect to Google or Instagram. Paste the links yourself; nothing is posted
        for you.
      </p>
    </section>
  )
}
