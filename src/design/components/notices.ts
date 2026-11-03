type Notice = { id: number; text: string; tone: 'done' | 'problem'; at: number }

let notices: Notice[] = []
let next = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

/**
 * A short notice in the corner for something that happened where the person may not be looking:
 * a pop-up that closed as it saved, a visit dragged to a new time. It says what really happened
 * ("Saved", "Recorded", "Queued"), never more. Where a saved line already sits beside the button,
 * that line stays and no notice is needed. Nothing happens until `Notices` is on the page.
 */
export function notify(text: string, tone: Notice['tone'] = 'done') {
  // Each notice closes itself (and leaves gently); ones long gone are forgotten here.
  const now = Date.now()
  notices = [
    ...notices.filter((notice) => now - notice.at < 20000).slice(-2),
    { id: next++, text, tone, at: now },
  ]
  emit()
}

export const subscribeNotices = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const readNotices = () => notices
