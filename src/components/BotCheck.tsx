import { useEffect, useRef, useState } from 'react'

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ) => string
  remove: (widgetId: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<TurnstileApi> | null = null
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('unavailable'))
    script.onerror = () => {
      loading = null
      reject(new Error('unavailable'))
    }
    document.head.append(script)
  })
  return loading
}

/**
 * Cloudflare Turnstile, shown only when the studio switched the bot check on.
 * Each token is single use: remount (change `key`) after every hold attempt for a fresh one.
 */
export function BotCheck({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string) => void
}) {
  const element = useRef<HTMLDivElement>(null),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    let widget = '',
      active = true
    onToken('')
    loadTurnstile()
      .then((turnstile) => {
        if (!active || !element.current) return
        widget = turnstile.render(element.current, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => setFailed(true),
        })
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (widget) window.turnstile?.remove(widget)
    }
  }, [siteKey, onToken])
  return (
    <div className="bot-check">
      <div ref={element} />
      {failed && (
        <p role="alert">
          The quick check could not load. Refresh the page, or contact the studio to book.
        </p>
      )}
    </div>
  )
}
