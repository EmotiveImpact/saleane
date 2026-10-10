import { useLocation } from 'react-router-dom'
import { StoreProvider } from './state/StoreProvider'
import { App } from './App'
import { DaySheetGate } from './components/DaySheetGate'
import { StudioLanding } from './components/StudioLanding'
import { MarketingHome } from './pages/MarketingHome'

/** The public home has no studio state. Workspace routes keep their existing guards. */
export function FrontDoor() {
  const { pathname } = useLocation()
  if (pathname === '/') return <MarketingHome />
  return (
    <StoreProvider>
      <DaySheetGate>
        <StudioLanding>
          <App />
        </StudioLanding>
      </DaySheetGate>
    </StoreProvider>
  )
}
