import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../react/look.css'
import './page.css'
import { CALEANE, TALLY } from '../examples'
import { InstallPage } from './InstallPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InstallPage apps={[CALEANE, TALLY]} />
  </StrictMode>,
)
