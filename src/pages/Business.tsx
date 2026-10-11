import { useState } from 'react'
import { Download, Info, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { bookedTimeShare, dueClients, report } from '../domain/selectors'
import { hasLocations, placeOf, places } from '../domain/locations'
import { bookedTimeDefinition } from '../components/definitions'
import { RetentionPanel } from '../components/RetentionPanel'
import { WholeBusiness } from '../components/WholeBusiness'
import { dateLabel, money, wholeMoney } from '../domain/format'
import { barHeight, chartScale } from '../domain/chartScale'
import { closingLedger } from '../domain/moments'
import { ClosingLedger } from '../components/ClosingLedger'
import { FirstStep } from '../components/FirstStep'
import {
  Avatar,
  Button,
  Empty,
  Metric,
  PageHeader,
  SegmentedControl,
  photos,
  treatmentPhoto,
  Select,
  Tip,
} from '../design'

const completedVisits = (count: number) => `${count} completed ${count === 1 ? 'visit' : 'visits'}`

export function Business() {
  const { state, today, branch, role } = useStore()
  // Stage 3: rent is shown to those who see pay; everyone sees that renters' takings are kept out.
  const seesRent = role === 'owner' || role === 'manager'
  const [days, setDays] = useState(7)
  const [definitions, setDefinitions] = useState(false)
  // V2: figures for one location, or the whole studio.
  const multiSite = hasLocations(state)
  const [where, setWhere] = useState(branch ?? 'all')
  const place = multiSite && where !== 'all' ? where : undefined
  // Stage 4: a general manager sees only their own location's team and hours, so time booked
  // elsewhere cannot be worked out on their screen.
  const teamHidden = role === 'general' && !!branch && multiSite && place !== branch
  const data = report(state, days, place)
  const due = dueClients(state)
  // Stage 6: round figures on the axis, and only zero when nothing was taken.
  const scale = chartScale(data.byDay.map((d) => d.revenue))
  // Today's close: visits still open and who comes first tomorrow, and once every visit is checked
  // out, the day as a printed ledger (Stage 6).
  const closing = closingLedger(state, place)
  function exportReport() {
    const rows = [
      ['date', 'completed_service_revenue_minor', 'currency'],
      ...data.byDay.map((d) => [d.date, String(d.revenue), state.organisation.currency]),
    ]
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const placeSlug = place
      ? `-${(placeOf(state, place)?.name ?? 'location').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      : ''
    link.download = `saleane-report-${state.organisation.region}${placeSlug}-${today}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  // A new studio has nothing to count yet, so it meets a welcome rather than a page of noughts.
  if (!state.appointments.length && !state.sales.length)
    return (
      <Empty
        photo={photos.calmStudio}
        photoPosition="62% center"
        eyebrow="Business"
        level={1}
        title="Your figures begin with your first visit."
        action={<FirstStep to="/calendar">Open the calendar</FirstStep>}
      >
        Takings, time booked and rebooking fill in here as visits are checked out, with the day’s
        close and who is due back alongside.
      </Empty>
    )
  return (
    <>
      <PageHeader
        variant="compact"
        eyebrow="Business"
        title="A clearer view."
        description="Understand the rhythm. Choose what comes next."
        actions={
          <Button variant="secondary" onClick={exportReport}>
            <Download size={17} />
            Export report
          </Button>
        }
      />
      <div className="business-period">
        <SegmentedControl
          label="Reporting period"
          value={String(days)}
          onChange={(value) => setDays(Number(value))}
          options={[7, 28].map((value) => ({ value: String(value), label: `Last ${value} days` }))}
        />
        {multiSite && (
          <label className="business-where">
            <span className="sr-only">Location</span>
            <Select id="business-location" value={where} onChange={(e) => setWhere(e.target.value)}>
              <option value="all">All locations</option>
              {places(state).map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <span>
          {dateLabel(data.from, state.organisation.locale, true)} –{' '}
          {dateLabel(today, state.organisation.locale, true)}
        </span>
      </div>
      {multiSite && !place && <WholeBusiness />}
      <div className="metrics-band">
        <Metric
          label="Takings from completed treatments"
          value={wholeMoney(data.revenue, state.organisation)}
          detail={completedVisits(data.ownCompleted)}
        />
        <Metric
          label="Average treatment sale"
          value={wholeMoney(
            data.ownCompleted ? Math.round(data.revenue / data.ownCompleted) : 0,
            state.organisation,
          )}
          detail="Treatment takings ÷ completed visits"
        />
        <Metric
          label="Time booked"
          value={teamHidden ? 'Not shown' : `${Math.round(data.utilisation * 100)}%`}
          detail={
            teamHidden
              ? `Shown for ${placeOf(state, branch!)?.name ?? 'your location'} only, whose team you see.`
              : `Last ${days} days · today ${Math.round(bookedTimeShare(state, today, place) * 100)}%`
          }
          definition={bookedTimeDefinition.map((line) => (
            <p key={line}>{line}</p>
          ))}
        />
        <Metric
          label="Recorded rebooking"
          value={data.rebookRate === null ? '—' : `${Math.round(data.rebookRate * 100)}%`}
          detail="Completed visits linked to a next visit"
        />
      </div>
      <div className="business-layout">
        <section className="surface chart-panel">
          <div className="section-heading">
            <div>
              <h2>Revenue has a rhythm.</h2>
              <p>Completed treatments, with deposits counted once.</p>
            </div>
            <span className="chart-total">{wholeMoney(data.revenue, state.organisation)}</span>
          </div>
          <div
            className="revenue-chart"
            role="img"
            aria-label={`Takings from completed treatments by day over the last ${days} days, ${money(data.revenue, state.organisation)} total. Exact values are available in the table below.`}
          >
            <div className="chart-axis">
              <span>{scale.top ? money(scale.top, state.organisation) : ''}</span>
              <span>{scale.top ? money(scale.half, state.organisation) : ''}</span>
              <span>{money(0, state.organisation)}</span>
            </div>
            <div className="chart-bars">
              {data.byDay.map((d, i) => (
                <div className="chart-column" key={d.date}>
                  <Tip
                    label={`${dateLabel(d.date, state.organisation.locale, true)}: ${money(d.revenue, state.organisation)}`}
                  >
                    <div
                      className={`chart-bar ${d.date === today ? 'current-bar' : ''}`}
                      style={{ height: `${barHeight(d.revenue, scale)}%` }}
                    />
                  </Tip>
                  <span>
                    {days === 7
                      ? new Intl.DateTimeFormat(state.organisation.locale, {
                          weekday: 'short',
                          timeZone: 'UTC',
                        }).format(new Date(`${d.date}T12:00:00Z`))
                      : i % 7 === 0 || i === 27
                        ? d.date.slice(8)
                        : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <details className="chart-data">
            <summary>View daily values</summary>
            <table>
              <caption>Takings from completed treatments by visit date</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Treatment takings ({state.organisation.currency})</th>
                </tr>
              </thead>
              <tbody>
                {data.byDay.map((d) => (
                  <tr key={d.date}>
                    <td>{dateLabel(d.date, state.organisation.locale, true)}</td>
                    <td>{money(d.revenue, state.organisation, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="business-insight">
          <TrendingUp size={26} />
          <h2>The next chapter is in your relationships.</h2>
          <p>
            {due.length} clients have no next visit after at least four weeks away. Start with a
            considered invitation.
          </p>
          <Link className="button button-light" to="/clients">
            Review your clients
          </Link>
          {/* Each figure under its own rule; on a smaller screen they sit side by side. */}
          <div className="insight-figures">
            <div className="insight-figure">
              <span>Tips recorded in this period</span>
              <strong>{wholeMoney(data.tips, state.organisation)}</strong>
              <small>Reported separately from treatment takings.</small>
            </div>
            <div className="insight-figure">
              <span>Products sold with visits</span>
              <strong>{wholeMoney(data.retail, state.organisation)}</strong>
              <small>
                Before tax, separate from treatment takings.{' '}
                <Link to="/business/stock">See stock</Link>
              </small>
            </div>
            <div className="insight-figure">
              <span>Gift cards, packages and memberships sold</span>
              <strong>{money(data.giftCardsSold + data.plansSold, state.organisation)}</strong>
              <small>Money taken where they were sold, separate from treatment takings.</small>
            </div>
            {seesRent && (data.rent > 0 || data.renters > 0) && (
              <div className="insight-figure">
                <span>Chair and room rent recorded</span>
                <strong>{money(data.rent, state.organisation)}</strong>
                <small>
                  Your income from renters. <Link to="/business/pay">See rent</Link>
                </small>
              </div>
            )}
            {data.otherTill !== 0 && (
              <div className="insight-figure">
                <span>Sold on your other tills</span>
                <strong>{money(data.otherTill, state.organisation)}</strong>
                <small>
                  Before tax, sent in by {data.tills.join(' and ')}. Taken on those tills, not by
                  SALEANE, and kept apart from treatment takings here.
                </small>
              </div>
            )}
            {data.renters > 0 && (
              <div className="insight-figure">
                <span>Renters’ own takings, kept apart</span>
                <strong>{money(data.renters, state.organisation)}</strong>
                <small>Not counted in any figure here. They came through your till.</small>
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="business-tables">
        <section className="surface detail-panel">
          <h2>What people come for</h2>
          <div className="service-performance">
            {data.byService.map(({ service, revenue, visits }) => (
              <div key={service.id}>
                <span>
                  <strong>{service.name}</strong>
                  <small>{completedVisits(visits)}</small>
                </span>
                <strong>{money(revenue, state.organisation)}</strong>
                <div className="performance-track">
                  <span
                    style={{ width: `${data.revenue ? (revenue / data.revenue) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="surface detail-panel">
          <h2>The people behind it</h2>
          {data.byStaff.map(({ staff, revenue, visits, renting, rebooked }) => (
            <div className="staff-performance" key={staff.id}>
              <Avatar small identity={staff.id} name={staff.name} tone={staff.tone} />
              <span>
                <strong>{staff.name}</strong>
                <small>
                  {completedVisits(visits)}
                  {renting > 0 && `, ${renting} while renting`}
                  {visits > 0 && ` · ${Math.round((rebooked / visits) * 100)}% rebooked`}
                </small>
              </span>
              <strong>{money(revenue, state.organisation)}</strong>
            </div>
          ))}
          <p className="subtle">
            Treatment takings only, without renters’ own takings.
            {data.rebookRate !== null &&
              ` Rebooked means the next visit was booked at checkout; the studio as a whole rebooked ${Math.round(data.rebookRate * 100)}%.`}{' '}
            Commission and tips per person are on <Link to="/business/pay">Pay</Link>.
          </p>
        </section>
      </div>
      <div className="business-photos">
        <section className="surface detail-panel booking-preview">
          <div className="section-heading">
            <div>
              <h2>Your booking page</h2>
              <p>What guests see before they book.</p>
            </div>
            <Link className="button button-secondary" to="/booking">
              Open the page
            </Link>
          </div>
          <div
            className="booking-preview-hero"
            style={{ backgroundImage: `url(${photos.reception})` }}
            role="img"
            aria-label="A fictional reception in morning light"
          />
          <ul className="booking-preview-tiles">
            {state.services.slice(0, 4).map((service, i, shown) => {
              const photo = treatmentPhoto(
                service.category,
                shown.slice(0, i).filter((s) => s.category === service.category).length,
              )
              return (
                <li key={service.id}>
                  <span
                    aria-hidden="true"
                    style={{
                      backgroundImage: `url(${photo.src})`,
                      backgroundPosition: photo.position,
                    }}
                  />
                  <strong>{service.name}</strong>
                  <small>
                    {service.durationMinutes} minutes ·{' '}
                    {money(service.priceMinor, state.organisation)}
                  </small>
                </li>
              )
            })}
          </ul>
        </section>
        <section className="surface detail-panel closing-up">
          <div
            className="closing-up-photo"
            style={{ backgroundImage: `url(${photos.endOfDay})` }}
            role="img"
            aria-label="A fictional treatment room in late afternoon light"
          />
          <span className="closing-up-eyebrow">Closing up</span>
          <h2>{closing.settled ? 'The day is settled.' : 'Before you close.'}</h2>
          {closing.ledger ? (
            <ClosingLedger ledger={closing.ledger} organisation={state.organisation} />
          ) : (
            <p>
              {closing.total === 0
                ? 'No visits were booked today.'
                : `${closing.open} of today’s ${closing.total} visits still to check out.`}{' '}
              {closing.tomorrowLine}
            </p>
          )}
        </section>
      </div>
      <RetentionPanel days={days} />
      <div className="metric-definitions">
        <button
          className="text-link"
          aria-expanded={definitions}
          onClick={() => setDefinitions(!definitions)}
        >
          <Info size={15} />
          How these numbers are calculated
        </button>
        {definitions && (
          <p>
            Takings use completed treatment receipts by visit date, leave out tips and count each
            treatment's value after discounts and without included tax, once. A deposit is a
            part-payment. Refunds are shown separately in Money and are not deducted here. Time
            booked uses booked treatment minutes against opening and professional hours, less
            recorded closures. Earlier days use the current schedule; schedule versions are not yet
            retained. Rebooking counts explicit links created through checkout, rather than assuming
            another visit is a rebook. Someone renting a chair or room keeps their own takings on
            the days they rent, so takings, averages and products leave them out; their rent is the
            studio’s income. Time booked and rebooking still count their visits. All figures come
            from this studio’s records. Money recorded by hand has not been checked against a card
            company.
          </p>
        )}
      </div>
    </>
  )
}
