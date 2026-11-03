/**
 * The button a menu was opened from, kept for the moment it takes a menu item to open a dialog
 * or panel. The item has gone by the time the dialog closes, so the dialog gives the focus back
 * to this button instead, where the person was.
 */
let opener: HTMLElement | null = null

export function rememberOpener(item: Element | null) {
  const menu = item?.closest('[role="menu"]')
  const button = menu && document.getElementById(menu.getAttribute('aria-labelledby') ?? '')
  opener = button instanceof HTMLElement ? button : null
  // Anything that opens from the item opens straight away, so the button is not kept beyond that.
  setTimeout(() => (opener = null))
}

export function takeOpener() {
  const button = opener?.isConnected ? opener : null
  opener = null
  return button
}
