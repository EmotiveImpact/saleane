import { Fragment } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useStore } from '../state/context'
import type { Appointment } from '../domain/model'
import { money, timeLabel } from '../domain/format'
import { shownStatus } from '../domain/selectors'
import { Avatar, Empty, Status } from '../design'
import { milestoneTag, visitMilestones } from '../domain/beforeVisit'
import './moments.css'

export function Agenda({
  appointments,
  onOpen,
  selectedId,
  nowMinutes,
}: {
  appointments: Appointment[]
  onOpen: (id: string) => void
  selectedId?: string
  /** Minutes past midnight on the studio clock; draws the "now" line when the day is today. */
  nowMinutes?: number
}) {
  const { state } = useStore()
  if (!appointments.length)
    return (
      <Empty title="A little breathing room">No visits on this day. Add one to get started.</Empty>
    )
  return (
    <div className="agenda-list">
      <div className="agenda-labels" aria-hidden="true">
        <span>Time</span>
        <span>Client & treatment</span>
        <span>Professional</span>
        <span>Status</span>
        <span>Value</span>
      </div>
      {appointments.map((a, index) => {
        const nowHere =
          nowMinutes !== undefined &&
          a.startMinutes > nowMinutes &&
          (index === 0 || appointments[index - 1].startMinutes <= nowMinutes)
        const client = state.clients.find((c) => c.id === a.clientId)!
        const staff = state.staff.find((s) => s.id === a.staffId)!
        const service = state.services.find((s) => s.id === a.serviceId)!
        // Stage 6: a quiet tag for a visit that brings a milestone, while it is still to come.
        const moment =
          a.status === 'confirmed' || a.status === 'arrived'
            ? visitMilestones(state, a).map(milestoneTag)[0]
            : undefined
        return (
          <Fragment key={a.id}>
            {nowHere && (
              <div className="agenda-now" aria-hidden="true">
                <span>{timeLabel(nowMinutes, state.organisation.locale)}</span>
              </div>
            )}
            <button
              className={`agenda-row agenda-${a.status}`}
              data-selected={selectedId === a.id ? '' : undefined}
              aria-haspopup="dialog"
              aria-expanded={selectedId === a.id}
              onClick={() => onOpen(a.id)}
            >
              <span className="agenda-time">
                {timeLabel(a.startMinutes, state.organisation.locale)}{' '}
                <small>{a.bookedDurationMinutes} min</small>
              </span>{' '}
              <span className="agenda-client">
                <Avatar small identity={client.id} name={client.name} tone={staff.tone} />
                <span>
                  <strong>{client.name}</strong> <small>{service.name}</small>{' '}
                  {moment && <span className="agenda-moment">{moment}</span>}{' '}
                  <span className="agenda-mobile-meta">
                    <span className="agenda-meta-staff">with {staff.name.split(' ')[0]}</span>{' '}
                    <span className="agenda-meta-status">
                      <Status status={shownStatus(a)} />
                    </span>
                  </span>
                </span>
              </span>{' '}
              <span className="agenda-professional">{staff.name.split(' ')[0]}</span>{' '}
              <Status status={shownStatus(a)} />{' '}
              <span className="agenda-value">
                {money(a.bookedPriceMinor, state.organisation)}
                <ArrowUpRight size={15} />
              </span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
