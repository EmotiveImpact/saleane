import './runtime'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/figtree'
import '@fontsource-variable/newsreader/opsz.css'
import '../src/styles.css'
import './demo.css'
import { StoreProvider } from '../src/state/StoreProvider'
import { App } from '../src/App'
import { DaySheetGate } from '../src/components/DaySheetGate'
import { DEMO_EMAIL, DEMO_PASSWORD, resetDemo, startDemoServer } from './server'

// The page may be served from a sub-folder; the app's own paths sit underneath it.
const base = location.pathname.replace(/\/(index\.html)?$/, '').replace(/\/[^/]*\.html$/, '')
if (!sessionStorageGet('saleane.demo.base')) sessionStorageSet('saleane.demo.base', base)
const basename = sessionStorageGet('saleane.demo.base') ?? base
// Open on the app's own front door rather than the file name the page was served under.
if (location.pathname === base || /\.html$/.test(location.pathname))
  history.replaceState(null, '', `${basename}/`)

function sessionStorageGet(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
function sessionStorageSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Not available; the current address is used.
  }
}

// Plain links such as href="/account" become in-app moves, so they never leave the demo page.
document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest?.('a')
  if (!link || event.defaultPrevented || event.button !== 0 || link.target === '_blank') return
  const href = link.getAttribute('href') ?? ''
  if (!href.startsWith('/') || href.startsWith('//')) return
  if (basename && href.startsWith(`${basename}/`)) return
  event.preventDefault()
  history.pushState(null, '', `${basename}${href}`)
  dispatchEvent(new PopStateEvent('popstate'))
})

function DemoNote() {
  return (
    <details className="demo-note">
      <summary>Demo</summary>
      <p>Fictional studios. Nothing is sent or charged. Your changes stay in this browser.</p>
      <p>
        Sign in again with {DEMO_EMAIL} and the password {DEMO_PASSWORD}.
      </p>
      <button
        type="button"
        onClick={() => {
          resetDemo()
          location.replace(`${basename}/`)
        }}
      >
        Start the demo again
      </button>
    </details>
  )
}

const root = createRoot(document.getElementById('root')!)
startDemoServer(basename)
  .then(() => {
    root.render(
      <StrictMode>
        <BrowserRouter basename={basename || undefined}>
          <StoreProvider>
            <DaySheetGate>
              <App />
            </DaySheetGate>
          </StoreProvider>
        </BrowserRouter>
        <DemoNote />
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    document.getElementById('root')!.textContent = `The demo could not start: ${String(error)}`
  })
