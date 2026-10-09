import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  Home,
  Search,
  Settings2,
  Users,
  Menu,
  X,
  Info,
  Mail,
  Hourglass,
  Sparkles,
  CircleHelp,
} from 'lucide-react'
import { useStore } from './state/context'
import { useStudioColours } from './state/studioColours'
import { leads, operations } from './domain/operations'
import { hasLocations, places } from './domain/locations'
import { regions } from './domain/group'
import { staleOffer } from './domain/waitlist'
import { nudges } from './domain/nudges'
import { Avatar, Modal, ScrollNav } from './design'
import { SearchDialog } from './components/SearchDialog'
import { BillingBanner } from './components/BillingBanner'
import { Today } from './pages/Today'
// Every page but Today loads when it is first opened, so the first screen arrives sooner.
const Calendar = lazy(() =>
  import('./pages/Calendar').then((module) => ({ default: module.Calendar })),
)
const Clients = lazy(() =>
  import('./pages/Clients').then((module) => ({ default: module.Clients })),
)
const ClientRelationship = lazy(() =>
  import('./pages/ClientRelationship').then((module) => ({ default: module.ClientRelationship })),
)
const Business = lazy(() =>
  import('./pages/Business').then((module) => ({ default: module.Business })),
)
const Stock = lazy(() => import('./pages/Stock').then((module) => ({ default: module.Stock })))
const Pay = lazy(() => import('./pages/Pay').then((module) => ({ default: module.Pay })))
const Rota = lazy(() => import('./pages/Rota').then((module) => ({ default: module.Rota })))
const Accounts = lazy(() =>
  import('./pages/Accounts').then((module) => ({ default: module.Accounts })),
)
const BranchVisits = lazy(() =>
  import('./pages/BranchVisits').then((module) => ({ default: module.BranchVisits })),
)
const Requests = lazy(() =>
  import('./pages/Requests').then((module) => ({ default: module.Requests })),
)
const ClientAreas = lazy(() =>
  import('./pages/ClientAreas').then((module) => ({ default: module.ClientAreas })),
)
const Compare = lazy(() =>
  import('./pages/Compare').then((module) => ({ default: module.Compare })),
)
const BrandedBooking = lazy(() =>
  import('./pages/BrandedBooking').then((module) => ({ default: module.BrandedBooking })),
)
const AccessPanel = lazy(() =>
  import('./components/AccessPanel').then((module) => ({ default: module.AccessPanel })),
)
const HelpPanel = lazy(() =>
  import('./components/HelpPanel').then((module) => ({ default: module.HelpPanel })),
)
const PractitionerDay = lazy(() =>
  import('./pages/PractitionerDay').then((module) => ({ default: module.PractitionerDay })),
)
const AreaHome = lazy(() =>
  import('./pages/AreaHome').then((module) => ({ default: module.AreaHome })),
)
const ManageVisit = lazy(() =>
  import('./pages/ManageVisit').then((module) => ({ default: module.ManageVisit })),
)
const TestPayment = lazy(() =>
  import('./pages/TestPayment').then((module) => ({ default: module.TestPayment })),
)
const TestBillingCard = lazy(() =>
  import('./pages/TestBillingCard').then((module) => ({ default: module.TestBillingCard })),
)
const LockedStudio = lazy(() =>
  import('./pages/LockedStudio').then((module) => ({ default: module.LockedStudio })),
)
const Pricing = lazy(() =>
  import('./pages/Pricing').then((module) => ({ default: module.Pricing })),
)
const Account = lazy(() =>
  import('./pages/Account').then((module) => ({ default: module.Account })),
)
const AccountLink = lazy(() =>
  import('./pages/AccountLink').then((module) => ({ default: module.AccountLink })),
)
const ServerBooking = lazy(() =>
  import('./pages/ServerBooking').then((module) => ({ default: module.ServerBooking })),
)
const Manage = lazy(() => import('./pages/Manage').then((module) => ({ default: module.Manage })))
const Inbox = lazy(() => import('./pages/Inbox').then((module) => ({ default: module.Inbox })))
const Money = lazy(() => import('./pages/Money').then((module) => ({ default: module.Money })))
const Waitlist = lazy(() =>
  import('./pages/Waitlist').then((module) => ({ default: module.Waitlist })),
)
const GiftCards = lazy(() =>
  import('./pages/GiftCards').then((module) => ({ default: module.GiftCards })),
)
const Feedback = lazy(() =>
  import('./pages/Feedback').then((module) => ({ default: module.Feedback })),
)
const AskSaleane = lazy(() =>
  import('./components/AskSaleane').then((module) => ({ default: module.AskSaleane })),
)
const DesignLanguage = lazy(() =>
  import('./pages/DesignLanguage').then((module) => ({ default: module.DesignLanguage })),
)
import { useClock } from './state/clock'
import './account.css'

const navigation = [
  { to: '/today', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/waitlist', label: 'Waitlist', icon: Hourglass },
  { to: '/inbox', label: 'Inbox', icon: Mail },
  { to: '/business', label: 'Business', icon: ChartNoAxesCombined },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]
/** Whether a sidebar section holds the page that is open, including the pages inside it. */
const within = (pathname: string, section: string) =>
  pathname === section || pathname.startsWith(`${section}/`)

function WorkspaceApp() {
  const { state, warning, mode, slug, loading, session, role, reload, today, branch, billing } =
    useStore()
  const operator = session?.user.name ?? 'Demo operator'
  const initials = state.organisation.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
  const location = useLocation()
  // V5: the studio's own colours; a guest booking page applies the colours of the studio it books.
  useStudioColours(
    state.organisation.id,
    operations(state).look,
    !location.pathname.startsWith('/book/'),
  )
  const [search, setSearch] = useState(false)
  const [asking, setAsking] = useState(false)
  const [helping, setHelping] = useState(false)
  const navigate = useNavigate()
  const openSettings = (section: string) => navigate(`/settings?section=${section}`)
  const [mobileNav, setMobileNav] = useState(false)
  // Waitlist offers whose time has gone are not counted as waiting for approval.
  const clock = useClock()
  // Read again each minute too, so a waitlist time that has passed stops counting.
  const noticed = useMemo(
    () => nudges(state, role, today, clock).length,
    [state, role, today, clock],
  )
  const drafts = operations(state).messages.filter(
    (m) => m.status === 'draft' && !staleOffer(state, m.id, clock),
  ).length
  // The front desk opens Money, Stock, Rota and Gift cards in Business, not the studio's figures,
  // pay, accounts or private feedback, so their Business link lands on Money.
  const desk = role === 'reception'
  const links = navigation.map((item) => ({
    ...item,
    href: desk && item.to === '/business' ? '/business/money' : item.to,
    active: within(location.pathname, item.to),
  }))
  const owns = role === 'owner' || role === 'manager'
  // Branch visits and Requests are about running several branches, so they wait until there are
  // more locations or any regions. A general manager runs one of several, so always has them.
  const branches = hasLocations(state) || regions(state).length > 0 || role === 'general'
  const businessTabs = [
    { to: '/business', label: 'Overview', show: !desk },
    { to: '/business/money', label: 'Money', show: true },
    { to: '/business/stock', label: 'Stock', show: true },
    { to: '/business/rota', label: 'Rota', show: true },
    { to: '/business/gift-cards', label: 'Gift cards', show: role !== 'practitioner' },
    { to: '/business/pay', label: 'Pay', show: owns },
    { to: '/business/accounts', label: 'Accounts', show: owns },
    { to: '/business/compare', label: 'How you compare', show: owns },
    { to: '/business/feedback', label: 'Feedback', show: leads(role) },
    { to: '/business/visits', label: 'Branch visits', show: leads(role) && branches },
    { to: '/business/requests', label: 'Requests', show: leads(role) && branches },
    { to: '/business/areas', label: 'Client areas', show: leads(role) },
  ].filter((tab) => tab.show)
  useEffect(() => {
    document.title = `${state.organisation.name} · SALEANE`
  }, [state.organisation.name])
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [location.pathname])
  const pageName =
    location.pathname === '/design-language'
      ? 'Design language'
      : (navigation.find((n) => location.pathname.startsWith(n.to))?.label ?? 'Today')
  if (location.pathname === '/account' || location.pathname === '/join') return <Account />
  if (location.pathname === '/reset-password' || location.pathname === '/confirm-email')
    return <AccountLink />
  if (location.pathname === '/manage') return <ManageVisit />
  if (location.pathname === '/pay/test') return <TestPayment />
  if (location.pathname === '/billing/test-card') return <TestBillingCard />
  if (location.pathname === '/pricing') return <Pricing />
  if (location.pathname.startsWith('/area/'))
    return (
      <Routes>
        <Route path="/area/:orgId" element={<AreaHome />} />
      </Routes>
    )
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
        <p role="status">Loading your saved records.</p>
      </main>
    )
  // NEXT-02: a locked studio opens only for its owner, and only to pay or download its records.
  if (mode === 'server' && billing?.locked) return <LockedStudio />
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
        <div className="sidebar-masthead">
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
          <p className="sidebar-tagline">
            A considered way to run
            <br /> a remarkable business.
          </p>
        </div>
        <button className="workspace-switch" onClick={() => openSettings('workspace')}>
          <span className="workspace-monogram">{initials}</span>
          <span>
            <strong>{state.organisation.name}</strong>
            <small>
              {branch
                ? `General manager · ${places(state, true).find((p) => p.id === branch)?.name ?? 'your location'}`
                : state.organisation.locationName}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav>
          {links.map(({ to, href, active, label, icon: Icon }) => (
            <Link
              onClick={() => setMobileNav(false)}
              className={`nav-link ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              key={to}
              to={href}
            >
              <Icon size={19} strokeWidth={1.6} />
              {label}
              {to === '/inbox' && drafts > 0 && (
                <span className="nav-count">
                  {drafts}
                  <span className="sr-only"> {drafts === 1 ? 'draft' : 'drafts'} to approve</span>
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link
            to="/booking"
            className="sidebar-photo"
            aria-label="Preview your studio’s booking experience"
          >
            <img src="/images/saleane-studio-warm-small.jpg" alt="" />
          </Link>
          <Link to="/booking" className="public-booking-link">
            Your booking page
          </Link>
          <div className="sidebar-footer">
            <span>
              <span className="live-dot" />
              {mode === 'demo'
                ? 'Fictional demo'
                : state.operations?.mode === 'sandbox'
                  ? 'Sample studio'
                  : session?.services.payments || session?.services.email
                    ? 'On this computer'
                    : 'Test mode'}
            </span>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <Modal
          open
          onClose={() => setMobileNav(false)}
          title="Menu"
          description={`Choose where to go in ${state.organisation.name}.`}
        >
          <nav className="mobile-route-menu">
            {links.map(({ to, href, active, label, icon: Icon }) => (
              <Link
                key={to}
                to={href}
                className={active ? 'active' : undefined}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMobileNav(false)}
              >
                <Icon size={19} />
                {label}
              </Link>
            ))}
            <Link to="/booking" onClick={() => setMobileNav(false)}>
              Your booking page
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
            <button className="ask-button" onClick={() => setAsking(true)}>
              <Sparkles size={17} />
              <span>
                Ask SALEANE
                {noticed > 0 && (
                  <span className="ask-count">
                    , {noticed} {noticed === 1 ? 'thing' : 'things'} to mention
                  </span>
                )}
              </span>
              {noticed > 0 && <i className="ask-dot" aria-hidden="true" />}
            </button>
            <button className="global-search" onClick={() => setSearch(true)}>
              <Search size={17} />
              <span>Find a client</span>
            </button>
            <button className="ask-button help-button" onClick={() => setHelping(true)}>
              <CircleHelp size={17} aria-hidden="true" />
              <span>Help</span>
            </button>
            <span className="header-divider" />
            <button className="operator-button" onClick={() => openSettings('preferences')}>
              <Avatar small name={operator} tone="sand" />
              <span>{operator.split(' ')[0]}</span>
              <span className="sr-only">, your preferences</span>
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
                ? 'Sample studio. Its clients, visits and payments are made up.'
                : session?.services.payments || session?.services.email
                  ? 'Local studio. Connected services are named in Settings.'
                  : 'Local studio. Messages and card payments run in test mode: nothing is sent or charged.'}
          </span>
          <button onClick={() => openSettings('workspace')}>About this version</button>
        </section>
        {warning && (
          <div role="alert" className="workspace-warning">
            {warning}
            <button onClick={() => openSettings('workspace')}>Open recovery controls</button>
          </div>
        )}
        <BillingBanner onOpen={() => openSettings('billing')} />
        <main
          key={state.organisation.id}
          tabIndex={-1}
          data-focus-fallback
          id="main-content"
          className="workspace-main"
        >
          {within(location.pathname, '/business') && (
            <ScrollNav
              label="Business sections"
              className="business-subnav"
              current={location.pathname}
            >
              {businessTabs.map((tab) => (
                <NavLink key={tab.to} end={tab.to === '/business'} to={tab.to}>
                  {tab.label}
                </NavLink>
              ))}
            </ScrollNav>
          )}
          <Suspense
            fallback={
              <div className="route-loading" role="status">
                <span className="sr-only">Loading…</span>
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              <Route path="/today" element={<Today />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/clients/:clientId" element={<ClientRelationship />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/waitlist" element={<Waitlist />} />
              <Route
                path="/business"
                element={desk ? <Navigate to="/business/money" replace /> : <Business />}
              />
              <Route path="/business/money" element={<Money />} />
              <Route
                path="/business/compare"
                element={owns ? <Compare /> : <Navigate to="/business" replace />}
              />
              <Route
                path="/business/feedback"
                element={leads(role) ? <Feedback /> : <Navigate to="/business" replace />}
              />
              <Route path="/business/stock" element={<Stock />} />
              <Route
                path="/business/accounts"
                element={
                  role === 'owner' || role === 'manager' ? (
                    <Accounts />
                  ) : (
                    <Navigate to="/business" replace />
                  )
                }
              />
              <Route
                path="/business/rota"
                element={role === 'practitioner' ? <Navigate to="/today" replace /> : <Rota />}
              />
              <Route
                path="/business/pay"
                element={
                  role === 'owner' || role === 'manager' ? (
                    <Pay />
                  ) : (
                    <Navigate to="/business" replace />
                  )
                }
              />
              <Route
                path="/business/visits"
                element={leads(role) ? <BranchVisits /> : <Navigate to="/business" replace />}
              />
              <Route
                path="/business/requests"
                element={leads(role) ? <Requests /> : <Navigate to="/business" replace />}
              />
              <Route
                path="/business/areas"
                element={leads(role) ? <ClientAreas /> : <Navigate to="/business" replace />}
              />
              <Route path="/business/gift-cards" element={<GiftCards />} />
              <Route path="/settings" element={<Manage accessPanel={<AccessPanel />} />} />
              <Route path="/business/manage" element={<Navigate to="/settings" replace />} />
              <Route path="/design-language" element={<DesignLanguage />} />
              <Route
                path="*"
                element={
                  <div className="empty empty-photo">
                    <h1>This page isn’t here.</h1>
                    <Link to="/today">Return to Today</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
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
      {helping && (
        <Suspense fallback={null}>
          <HelpPanel
            open
            onClose={() => setHelping(false)}
            role={role}
            signedIn={mode === 'server'}
            workspaceId={mode === 'server' ? state.organisation.id : null}
            onAsk={() => setAsking(true)}
            locale={state.organisation.locale}
          />
        </Suspense>
      )}
      {asking && (
        <Suspense fallback={null}>
          <AskSaleane onClose={() => setAsking(false)} />
        </Suspense>
      )}
    </div>
  )
}

export function App() {
  return (
    <Suspense
      fallback={
        <main className="candidate-loading">
          <span className="wordmark">SALEANE</span>
          <p role="status">Loading…</p>
        </main>
      }
    >
      <WorkspaceApp />
    </Suspense>
  )
}
