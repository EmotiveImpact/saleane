import { lazy, Suspense, useEffect, useState } from 'react'
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
  Mail,
} from 'lucide-react'
import { useStore } from './state/context'
import { Avatar, Modal } from './design'
import { SearchDialog } from './components/SearchDialog'
import { WorkspaceSettings } from './components/WorkspaceSettings'
import { Today } from './pages/Today'
import { Calendar } from './pages/Calendar'
import { Clients } from './pages/Clients'
import { ClientRelationship } from './pages/ClientRelationship'
import { Business } from './pages/Business'
import { BrandedBooking } from './pages/BrandedBooking'
const Account = lazy(() =>
  import('./pages/Account').then((module) => ({ default: module.Account })),
)
const ServerBooking = lazy(() =>
  import('./pages/ServerBooking').then((module) => ({ default: module.ServerBooking })),
)
const Manage = lazy(() => import('./pages/Manage').then((module) => ({ default: module.Manage })))
const Inbox = lazy(() => import('./pages/Inbox').then((module) => ({ default: module.Inbox })))
const Money = lazy(() => import('./pages/Money').then((module) => ({ default: module.Money })))
const DesignLanguage = lazy(() =>
  import('./pages/DesignLanguage').then((module) => ({ default: module.DesignLanguage })),
)
import { AccessPanel } from './components/AccessPanel'
import { PractitionerDay } from './pages/PractitionerDay'
import { ManageVisit } from './pages/ManageVisit'
import './account.css'

const navigation = [
  { to: '/today', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/inbox', label: 'Inbox', icon: Mail },
  { to: '/business', label: 'Business', icon: ChartNoAxesCombined },
]

function WorkspaceApp() {
  const { state, warning, mode, slug, loading, session, role, reload } = useStore()
  const operator = session?.user.name ?? 'Demo operator'
  const initials = state.organisation.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
  const location = useLocation()
  const [search, setSearch] = useState(false)
  const [settings, setSettings] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  useEffect(() => {
    document.title = `SALEANE — ${state.organisation.name}`
  }, [state.organisation.name])
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [location.pathname])
  const pageName =
    location.pathname === '/design-language'
      ? 'Design language'
      : (navigation.find((n) => location.pathname.startsWith(n.to))?.label ?? 'Today')
  if (location.pathname === '/account' || location.pathname === '/join') return <Account />
  if (location.pathname === '/manage') return <ManageVisit />
  if (location.pathname.startsWith('/practice/'))
    return (
      <Routes>
        <Route path="/practice/:orgId" element={<PractitionerDay />} />
      </Routes>
    )
  if (location.pathname.startsWith('/book/'))
    return (
      <Routes>
        <Route path="/book/:slug" element={<ServerBooking />} />
      </Routes>
    )
  if (loading)
    return (
      <main className="candidate-loading">
        <span className="wordmark">SALEANE</span>
        <h1>Opening your studio…</h1>
        <p role="status">Restoring your saved workspace.</p>
      </main>
    )
  if (location.pathname === '/booking')
    return mode === 'server' ? (
      <Navigate to={`/book/${slug}${location.search}`} replace />
    ) : (
      <BrandedBooking key={state.organisation.id} />
    )
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
          <span className="workspace-monogram">{initials}</span>
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
          <Link
            to="/booking"
            className="sidebar-photo"
            aria-label="Preview your studio’s booking experience"
          >
            <img src="/images/saleane-studio-warm.png" alt="" />
          </Link>
          <Link to="/booking" className="public-booking-link">
            <span>Your booking page</span>
            <ArrowUpRight size={16} />
          </Link>
          <div className="sidebar-footer">
            <span>
              <span className="live-dot" />
              Local V1 candidate
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
          description={`Choose where to work in ${state.organisation.name}.`}
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
            <span className="header-studio">{state.organisation.name}</span>
            <span className="header-slash" aria-hidden="true">
              /
            </span>
            <span>{pageName}</span>
          </div>
          <div>
            <button className="global-search" onClick={() => setSearch(true)}>
              <Search size={17} />
              <span>Find a client</span>
              <kbd aria-hidden="true">Search</kbd>
            </button>
            <span className="header-divider" />
            <button className="operator-button" onClick={() => setSettings(true)}>
              <Avatar small name={operator} tone="sand" />
              <span>{operator.split(' ')[0]}</span>
              <span className="sr-only">, workspace and market settings</span>
              <ChevronDown size={13} />
            </button>
          </div>
        </header>
        <section className="demo-notice" aria-label="About this version">
          <Info size={13} />
          <span>
            {mode === 'demo'
              ? 'Fictional demo. Records are saved in this browser.'
              : state.operations?.mode === 'sandbox'
                ? 'Local sample studio. Fictional appointments and simulated payments.'
                : 'Local studio. Payments are recorded manually; email delivery is unconfigured.'}
          </span>
          <button onClick={() => setSettings(true)}>About this version</button>
        </section>
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
          {location.pathname.startsWith('/business') && (
            <nav className="business-subnav" aria-label="Business sections">
              <NavLink end to="/business">
                Overview
              </NavLink>
              <NavLink to="/business/money">Money</NavLink>
              <NavLink to="/business/manage">Manage studio</NavLink>
            </nav>
          )}
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:clientId" element={<ClientRelationship />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route
              path="/business"
              element={
                role === 'reception' ? <Navigate to="/business/manage" replace /> : <Business />
              }
            />
            <Route path="/business/money" element={<Money />} />
            <Route path="/business/manage" element={<Manage accessPanel={<AccessPanel />} />} />
            <Route path="/design-language" element={<DesignLanguage />} />
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
            <Link className="text-link" to="/design-language">
              Design language
            </Link>
            {mode === 'server' && (
              <button className="text-link" onClick={() => void reload().catch(() => {})}>
                Refresh records
              </button>
            )}
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

export function App() {
  return (
    <Suspense
      fallback={
        <main className="candidate-loading">
          <span className="wordmark">SALEANE</span>
          <p role="status">Opening your workspace…</p>
        </main>
      }
    >
      <WorkspaceApp />
    </Suspense>
  )
}
