import { useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  Home,
  Search,
  Settings2,
  Users,
  ArrowUpRight,
  Menu,
  X,
  Info,
} from 'lucide-react'
import { useStore } from './state/context'
import { Avatar, Modal } from './components/ui'
import { SearchDialog } from './components/SearchDialog'
import { WorkspaceSettings } from './components/WorkspaceSettings'
import { Today } from './pages/Today'
import { Calendar } from './pages/Calendar'
import { Clients } from './pages/Clients'
import { ClientRelationship } from './pages/ClientRelationship'
import { Business } from './pages/Business'
import { BrandedBooking } from './pages/BrandedBooking'

const navigation = [
  { to: '/today', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/business', label: 'Business', icon: ChartNoAxesCombined },
]

export function App() {
  const { state, warning } = useStore()
  const location = useLocation()
  const [search, setSearch] = useState(false)
  const [settings, setSettings] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const pageName = navigation.find((n) => location.pathname.startsWith(n.to))?.label ?? 'Today'
  if (location.pathname === '/booking') return <BrandedBooking key={state.organisation.id} />
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <Link to="/today" className="wordmark" onClick={() => setMobileNav(false)}>
            SALEANE
          </Link>
          <button
            className="mobile-nav-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button className="workspace-switch" onClick={() => setSettings(true)}>
          <span className="workspace-monogram">AH</span>
          <span>
            <strong>{state.organisation.name}</strong>
            <small>{state.organisation.locationName}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav>
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              onClick={() => setMobileNav(false)}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              key={to}
              to={to}
            >
              <Icon size={19} strokeWidth={1.65} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/booking" className="public-booking-link">
            <span>Your booking page</span>
            <ArrowUpRight size={16} />
          </Link>
          <div className="sidebar-footer">
            <span>
              <span className="live-dot" />
              Foundation v0.2
            </span>
            <button
              className="icon-button"
              aria-label="Workspace settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={18} />
            </button>
          </div>
          <p>
            A considered way to run
            <br /> a remarkable business.
          </p>
        </div>
      </aside>
      {mobileNav && (
        <Modal
          open
          onClose={() => setMobileNav(false)}
          title="Your workspace"
          description="Choose where to work in Atelier House."
        >
          <nav className="mobile-route-menu">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={() => setMobileNav(false)}>
                <Icon size={19} />
                {label}
              </NavLink>
            ))}
            <Link to="/booking" onClick={() => setMobileNav(false)}>
              Your booking page <ArrowUpRight size={17} />
            </Link>
          </nav>
        </Modal>
      )}
      <div className="app-content">
        <header className="app-header">
          <div>
            <button
              className="icon-button mobile-nav-toggle"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span className="header-studio">Atelier House</span>
            <span className="header-slash">/</span>
            <span>{pageName}</span>
          </div>
          <div>
            <button
              aria-label="Find a client"
              className="global-search"
              onClick={() => setSearch(true)}
            >
              <Search size={17} />
              <span>Find a client</span>
              <kbd>Search</kbd>
            </button>
            <span className="header-divider" />
            <button
              aria-label="Workspace and market settings"
              className="operator-button"
              onClick={() => setSettings(true)}
            >
              <Avatar small name="Maya Lewis" tone="sand" />
              <span>Maya</span>
              <ChevronDown size={13} />
            </button>
          </div>
        </header>
        <div className="demo-notice">
          <Info size={13} />
          <span>Demo workspace. Bookings and payments are simulated.</span>
          <button onClick={() => setSettings(true)}>About this version</button>
        </div>
        {warning && (
          <div role="alert" className="workspace-warning">
            {warning}
            <button onClick={() => setSettings(true)}>Open recovery controls</button>
          </div>
        )}
        <main
          key={state.organisation.id}
          tabIndex={-1}
          data-focus-fallback
          id="main-content"
          className="workspace-main"
        >
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:clientId" element={<ClientRelationship />} />
            <Route path="/business" element={<Business />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>This page isn’t here.</h1>
                  <Link to="/today">Return to Today</Link>
                </div>
              }
            />
          </Routes>
          <footer className="workspace-footer">
            <span>SALEANE</span>
            <span>
              {state.organisation.locationName} · {state.organisation.currency} ·{' '}
              {state.organisation.timeZone}
            </span>
          </footer>
        </main>
      </div>
      {search && <SearchDialog onClose={() => setSearch(false)} />}
      {settings && <WorkspaceSettings onClose={() => setSettings(false)} />}
    </div>
  )
}
