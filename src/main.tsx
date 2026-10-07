import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/figtree'
import '@fontsource-variable/newsreader/opsz.css'
import './styles.css'
import { StoreProvider } from './state/StoreProvider'
import { App } from './App'
import { DaySheetGate } from './components/DaySheetGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <DaySheetGate>
          <App />
        </DaySheetGate>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
