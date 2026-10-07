import { ExternalLink } from 'lucide-react'
import type { GuestView } from '../domain/guest'

/**
 * V1.5: a neutral invitation to leave a public review. Every guest sees the same words after a
 * visit, whatever they rated it privately, and it never asks for a good review.
 */
export function GuestReview({ view }: { view: GuestView }) {
  if (!view.review) return null
  return (
    <section className="guest-review" aria-labelledby="review-heading">
      <h2 id="review-heading">Tell others about your visit</h2>
      <p className="subtle">
        If you would like to, you can leave a public review for {view.organisation.name}. Every
        guest gets this same invitation.
      </p>
      <a
        className="button button-secondary"
        href={view.review.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Leave a public review <ExternalLink size={15} aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </section>
  )
}
