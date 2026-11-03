import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can } from '../domain/operations'
import { money } from '../domain/format'
import { places } from '../domain/locations'
import { drawerConnected, noSaleProblem, tillPrinter } from '../domain/till'
import { Button, ErrorMessage, Select } from '../design'
import { drawerWords } from './tillEvents'
import type { TillEvent } from './tillEvents'
import './receipt.css'

type DrawerDay = { date: string; openings: TillEvent[]; summary: string }

/**
 * Stage 2, in the till count: every time the cash drawer opened through SALEANE on the day, who
 * opened it and why, and "Open the drawer" for a no sale, which always asks for a short reason.
 */
export function CashDrawer({ date }: { date: string }) {
  const { state, mode, session, role, blocked, branch } = useStore()
  const org = state.organisation
  const server = mode === 'server' && !!session && can(role, 'checkout')
  // A general manager opens only their own location's drawer; the server holds them to it.
  const drawers = places(state).filter(
    (site) =>
      !site.archived &&
      drawerConnected(tillPrinter(state, site.id)) &&
      (role !== 'general' || !branch || site.id === branch),
  )
  const [day, setDay] = useState<DrawerDay | null>(null)
  const [opening, setOpening] = useState(false)
  const [reason, setReason] = useState('')
  const [siteId, setSiteId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const base = `/api/workspaces/${encodeURIComponent(org.id)}/till`

  useEffect(() => {
    if (!server) return
    let active = true
    api<DrawerDay>(`${base}/drawer?date=${date}`)
      .then((next) => {
        if (active) setDay(next)
      })
      .catch(() => null)
    return () => {
      active = false
    }
  }, [server, base, date, state.revision, refresh])

  if (!server) return null
  const time = (instant: string) =>
    new Intl.DateTimeFormat(org.locale, {
      timeZone: org.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: org.locale === 'en-US',
    }).format(new Date(instant))
  const what = (event: TillEvent) =>
    event.cause === 'no_sale'
      ? `No sale: ${event.reason ?? ''}`
      : `${event.cause === 'refund' ? 'Cash refund' : 'Cash payment'}${event.receiptNumber ? `, ${event.receiptNumber}` : ''}`
  const chosen = drawers.find((site) => site.id === siteId) ?? drawers[0]

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || blocked || !chosen) return
    const problem = noSaleProblem(reason)
    if (problem) {
      setError(problem)
      return
    }
    setPending(true)
    setError('')
    setNotice('')
    try {
      const opened = await api<TillEvent>(`${base}/drawer`, {
        method: 'POST',
        body: {
          reason: reason.trim(),
          ...(role !== 'general' && chosen.id !== org.locationId ? { locationId: chosen.id } : {}),
        },
      })
      if (opened.status === 'failed') setError(drawerWords(opened))
      else {
        setNotice(drawerWords(opened))
        setReason('')
        setOpening(false)
      }
      setRefresh((n) => n + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The drawer could not be opened.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="till-history cash-drawer">
      <h3>The cash drawer</h3>
      <p className="cash-drawer-summary">
        {drawers.length || day?.openings.length
          ? (day?.summary ?? '')
          : 'To open the drawer automatically, connect a network receipt printer in Settings, Till and printer.'}
      </p>
      {!!day?.openings.length && (
        <div className="ops-ledger">
          {day.openings.map((event) => (
            <div className="ops-record" key={event.id}>
              <div className="ops-record-copy">
                <strong>
                  {time(event.createdAt)} · {what(event)}
                </strong>
                <small>
                  {event.actorName}
                  {places(state).length > 1
                    ? ` · ${places(state, true).find((p) => p.id === event.locationId)?.name ?? ''}`
                    : ''}{' '}
                  · {drawerWords(event)}
                </small>
              </div>
              {event.amountMinor !== null && (
                <span className="ops-record-money">
                  {event.cause === 'refund' ? '−' : ''}
                  {money(event.amountMinor, org, true)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="ops-save-note" aria-live="polite">
        {notice}
      </p>
      {drawers.length > 0 &&
        (opening ? (
          <form className="cash-drawer-form" onSubmit={open} aria-busy={pending}>
            <div className="ops-fields">
              <label className="ops-wide">
                Why is the drawer opening?
                <input
                  value={reason}
                  maxLength={80}
                  required
                  placeholder="Change for a £20"
                  onChange={(e) => {
                    setReason(e.target.value)
                    setError('')
                  }}
                />
                <small>Kept with the till count, with your name and the time.</small>
              </label>
              {drawers.length > 1 && (
                <label>
                  Which drawer
                  <Select value={chosen?.id} onChange={(e) => setSiteId(e.target.value)}>
                    {drawers.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" variant="secondary" disabled={pending || blocked}>
                {pending ? 'Opening…' : 'Open the drawer'}
              </Button>
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() => {
                  setOpening(false)
                  setError('')
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="ops-actions">
            <Button
              variant="secondary"
              disabled={blocked}
              onClick={() => {
                setOpening(true)
                setNotice('')
              }}
            >
              Open the drawer
            </Button>
          </div>
        ))}
    </div>
  )
}
