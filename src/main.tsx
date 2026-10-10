import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/figtree'
import '@fontsource-variable/newsreader/opsz.css'
import './styles.css'
import { FrontDoor } from './FrontDoor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <FrontDoor />
    </BrowserRouter>
  </StrictMode>,
)
