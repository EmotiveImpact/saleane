import type { SavedReply } from '../domain/inboxSchema'

/** A few ready answers for a studio that has not saved its own yet. */
export const defaultQuickReplies: SavedReply[] = [
  { id: 'quick-thanks', name: 'Thank you, see you soon', body: 'Thank you, see you soon.' },
  {
    id: 'quick-another-time',
    name: 'Would another time suit you?',
    body: 'Would another time suit you? Tell us which day works best and we will find you a time.',
  },
]

/** The chips over the reply box: the studio's own saved replies, or a few to start with. */
export const quickReplies = (saved: SavedReply[]) => (saved.length ? saved : defaultQuickReplies)
