import { useState } from 'react'
import { Download, Info, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/context'
import { bookedTimeShare, dueClients, report } from '../domain/selectors'
import { bookedTimeDefinition } from '../components/definitions'
import { dateLabel, money } from '../domain/format'
import { Avatar, Button, Metric, PageHeader, SegmentedControl } from '../design'

export function Business() {
  const { state, today } = useStore()
  const [days, setDays] = useState(7)
  const [definitions, setDefinitions] = useState(false)
  const data = report(state, days)
  const due = dueClients(state)
  const maxRevenue = Math.max(...data.byDay.map((d) => d.revenue), 1)
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
    link.download = `saleane-report-${state.organisation.region}-${today}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <PageHeader
        variant="compact"
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
        <span>
          {dateLabel(data.from, state.organisation.locale, true)} –{' '}
          {dateLabel(today, state.organisation.locale, true)}
        </span>
      </div>
      <div className="metrics-band">
        <Metric
          label="Completed service revenue"
          value={money(data.revenue, state.organisation)}
          detail={`${data.completed} completed visits`}
        />
        <Metric
          label="Average service sale"
          value={money(
            data.completed ? Math.round(data.revenue / data.completed) : 0,
            state.organisation,
          )}
          detail="Service revenue ÷ completed visits"
        />
        <Metric
          label="Time booked"
          value={`${Math.round(data.utilisation * 100)}%`}
          detail={`Last ${days} days · today ${Math.round(bookedTimeShare(state, today) * 100)}%`}
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
              <p>Completed services, with deposits counted once.</p>
            </div>
            <span className="chart-total">{money(data.revenue, state.organisation)}</span>
          </div>
          <div
            className="revenue-chart"
            role="img"
            aria-label={`Completed service revenue by day over the last ${days} days, ${money(data.revenue, state.organisation)} total. Exact values are available in the table below.`}
          >
            <div className="chart-axis">
              <span>{money(maxRevenue, state.organisation)}</span>
              <span>{money(Math.round(maxRevenue / 2), state.organisation)}</span>
              <span>{money(0, state.organisation)}</span>
            </div>
            <div className="chart-bars">
              {data.byDay.map((d, i) => (
                <div className="chart-column" key={d.date}>
                  <div
                    className={`chart-bar ${d.date === today ? 'current-bar' : ''}`}
                    style={{ height: `${(d.revenue / maxRevenue) * 100}%` }}
                    title={`${dateLabel(d.date, state.organisation.locale, true)}: ${money(d.revenue, state.organisation)}`}
                  />
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
              <caption>Completed service revenue by visit date</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Service revenue ({state.organisation.currency})</th>
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
          <div className="insight-rule" />
          <span>Tips recorded in this period</span>
          <strong>{money(data.tips, state.organisation)}</strong>
          <small>Reported separately from service revenue.</small>
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
                  <small>{visits} completed visits</small>
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
          {data.byStaff.map(({ staff, revenue, visits }) => (
            <div className="staff-performance" key={staff.id}>
              <Avatar small identity={staff.id} name={staff.name} tone={staff.tone} />
              <span>
                <strong>{staff.name}</strong>
                <small>{visits} completed visits</small>
              </span>
              <strong>{money(revenue, state.organisation)}</strong>
            </div>
          ))}
          <p className="subtle">
            Service revenue only. Commissions and payroll are a later version.
          </p>
        </section>
      </div>
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
            Revenue uses completed service receipts by appointment date, excludes tips and counts
            service value after discounts and excluding included tax, once. A deposit is a
            part-payment. Refunds are shown separately in Money and are not deducted here. Time
            booked uses booked service minutes against configured opening and professional hours,
            less recorded closures. Earlier days use the current schedule; schedule versions are not
            yet retained. Rebooking counts explicit links created through checkout, rather than
            assuming another appointment is a rebook. All figures come from this workspace’s
            records. A manual payment record is not processor settlement evidence.
          </p>
        )}
      </div>
    </>
  )
}
