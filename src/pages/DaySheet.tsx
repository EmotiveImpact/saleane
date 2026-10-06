import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CloudOff, Printer, RefreshCw } from 'lucide-react'
import { useStore } from '../state/context'
import { useDaySheet } from '../state/daySheet'
import type { SavedDaySheet } from '../state/daySheet'
import type { DaySheet } from '../domain/daySheet'
import { dateLabel, timeLabel } from '../domain/format'
import { Button, Empty, PageHeader, Status } from '../design'
import '../daysheet.css'

/** A moment in the venue's own time, with the date when it falls on another day. */
function clock(instant: string, sheet: DaySheet) {
  const { locale, timeZone } = sheet.organisation
  const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(instant))
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale === 'en-US',
    ...(day === sheet.date ? {} : { weekday: 'short', day: 'numeric', month: 'short' }),
  }).format(new Date(instant))
}

function Visits({ sheet }: { sheet: DaySheet }) {
  const locale = sheet.organisation.locale
  const studio = sheet.audience === 'studio'
  if (!sheet.visits.length)
    return (
      <Empty title="No visits on this day">
        {studio ? 'Nothing is booked for the studio today.' : 'Nothing is assigned to you today.'}
      </Empty>
    )
  return (
    <table className="day-sheet-table">
      <caption className="sr-only">Visits on {dateLabel(sheet.date, locale)}</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Client</th>
          <th scope="col">Service</th>
          {studio && <th scope="col">Professional</th>}
          <th scope="col">Room</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {sheet.visits.map((v) => (
          <tr key={v.id}>
            <td className="day-sheet-time">
              {timeLabel(v.startMinutes, locale)}
              <small>to {timeLabel(v.endMinutes % 1440, locale)}</small>
            </td>
            <td>
              <strong>{v.clientName}</strong>
              {studio && <small>{v.clientPhone || 'No phone recorded'}</small>}
            </td>
            <td>{v.serviceName}</td>
            {studio && <td>{v.professionalName}</td>}
            <td>{v.roomName}</td>
            <td>
              <Status status={v.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OfflineNotice({ saved, preview }: { saved: SavedDaySheet | null; preview: boolean }) {
  const store = useStore()
  const reconnecting = store.connection === 'reconnecting'
  const when = saved
    ? `the day sheet ${saved.source === 'demo' ? 'built' : 'saved'} at ${clock(saved.savedAt, saved.sheet)}, valid until ${clock(saved.sheet.expiresAt, saved.sheet)}`
    : ''
  return (
    <section className="day-sheet-offline" role="alert" aria-live="assertive">
      <CloudOff size={22} aria-hidden="true" />
      <div>
        <h2>
          {preview ? 'Preview of the offline view' : reconnecting ? 'Reconnecting' : 'Offline'}
        </h2>
        <p>
          {reconnecting
            ? 'Checking your sign-in and access before changes resume.'
            : saved
              ? `Showing ${when}. Changes are paused.`
              : 'No current day sheet is saved in this tab. Changes are paused.'}
        </p>
        {preview && (
          <p className="subtle">
            In a signed-in studio this screen replaces the workspace whenever SALEANE cannot be
            reached, and every change waits until your access is checked again.
          </p>
        )}
        {!preview && (
          <div className="day-sheet-actions">
            <Button
              variant="secondary"
              disabled={reconnecting}
              onClick={() => void store.reconnect()}
            >
              <RefreshCw size={16} />
              Try again
            </Button>
            {saved && (
              <Button variant="quiet" onClick={store.forgetDaySheet}>
                Remove from this tab
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * OFF-01: the read-only day sheet. At /day-sheet it is the printable paper fallback; while the
 * service is unreachable it replaces the whole workspace, so no change can be started.
 */
export function DaySheetScreen({ offline = false }: { offline?: boolean }) {
  const store = useStore()
  const saved = useDaySheet()
  const { search } = useLocation()
  const preview = !store.sheetWorkspace && new URLSearchParams(search).get('preview') === 'offline'
  const paused = offline || store.connection !== 'online'
  const { sheetWorkspace, connection, syncDaySheet } = store
  useEffect(() => {
    // Opening the printable sheet while connected fetches a fresh copy first.
    if (!offline && sheetWorkspace && connection === 'online')
      void syncDaySheet(sheetWorkspace).catch(() => {})
    // Only on arrival; later saves refresh the sheet from the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline, sheetWorkspace])
  const sheet = saved?.sheet
  const back =
    sheet?.audience === 'practitioner'
      ? `/practice/${encodeURIComponent(saved!.workspaceId)}`
      : '/today'
  return (
    <div className="day-sheet-layout">
      <header className="day-sheet-header">
        <span className="wordmark">SALEANE</span>
        {sheet && (
          <span>
            <strong>{sheet.organisation.name}</strong>
            <small>
              {sheet.professional ? `${sheet.professional.name} · ` : ''}
              {sheet.organisation.locationName}
            </small>
          </span>
        )}
      </header>
      <main id="main-content" className="day-sheet-main">
        {(paused || preview) && <OfflineNotice saved={saved} preview={preview} />}
        <PageHeader
          title={
            sheet ? `Day sheet · ${dateLabel(sheet.date, sheet.organisation.locale)}` : 'Day sheet'
          }
          description={
            saved
              ? `${saved.source === 'demo' ? 'Built in this browser from the fictional demo' : 'Last synced'} at ${clock(saved.savedAt, saved.sheet)} · valid until ${clock(saved.sheet.expiresAt, saved.sheet)} · read-only`
              : 'No current day sheet is saved in this tab.'
          }
          actions={
            <>
              {sheet && (
                <Button variant="secondary" onClick={() => window.print()}>
                  <Printer size={16} />
                  Print
                </Button>
              )}
              {!paused && (
                <Link className="button button-quiet" to={back}>
                  Back to your day
                </Link>
              )}
              {!paused && !store.sheetWorkspace && !preview && (
                <Link className="button button-quiet" to="/day-sheet?preview=offline">
                  Preview the offline view
                </Link>
              )}
            </>
          }
        />
        {sheet && (
          <section className="surface day-sheet-surface" aria-label="Visits">
            <Visits sheet={sheet} />
          </section>
        )}
        <p className="day-sheet-footnote">
          A read-only copy kept only in this tab. It is removed when you sign out, switch studio,
          close the tab or when it expires. If the owner changes your access while you are offline,
          this copy only learns that when the tab reconnects.
          {sheet?.audience === 'studio' &&
            ' It includes client names and phone numbers: keep a printed copy out of sight and shred it at the end of the day.'}
        </p>
      </main>
    </div>
  )
}
